import express from "express";
import crypto from "crypto";
import pool from "./db.js";
import { getSessionUser } from "./auth.js";
import { PROVIDERS, DEFAULT_PROVIDER, ProviderError } from "./providers.js";
import { rateLimit } from "./limits.js";

const SERVER_GEMINI_KEY = process.env.GEMINI_API_KEY;

// Users' own API keys are encrypted at rest (AES-256-GCM) so a database dump alone doesn't
// leak them. Any long random string works as the secret — it's hashed down to a 32-byte key.
const SECRET = process.env.KEY_ENCRYPTION_SECRET;
const CIPHER_KEY = SECRET ? crypto.createHash("sha256").update(SECRET).digest() : null;

if (!SECRET) {
  console.warn("KEY_ENCRYPTION_SECRET is not set — users won't be able to save their own AI provider keys.");
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", CIPHER_KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

function decrypt(stored) {
  const [, iv, tag, ct] = stored.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", CIPHER_KEY, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

async function loadSettings(userId) {
  const [{ rows: settingRows }, { rows: keyRows }] = await Promise.all([
    pool.query(`SELECT provider, models FROM ai_settings WHERE user_id = $1`, [userId]),
    pool.query(`SELECT provider, key_enc, key_hint FROM ai_keys WHERE user_id = $1`, [userId]),
  ]);
  const keys = Object.fromEntries(keyRows.map((r) => [r.provider, r]));
  let provider = settingRows[0]?.provider;
  // Fall back to the free tier if the saved choice is gone or its key was removed.
  if (!PROVIDERS[provider] || (provider !== DEFAULT_PROVIDER && !keys[provider])) provider = DEFAULT_PROVIDER;
  return { provider, models: settingRows[0]?.models || {}, keys };
}

// A key saved under a different KEY_ENCRYPTION_SECRET can't be decrypted. Say so plainly (as an
// auth problem, so the client points to AI settings) instead of a generic upstream failure.
function ownKeyFor(keys, provider) {
  if (!keys[provider] || !CIPHER_KEY) return null;
  try {
    return decrypt(keys[provider].key_enc);
  } catch {
    throw new ProviderError("Your saved API key can't be read anymore. Remove it and add it again.", { status: 400, kind: "auth" });
  }
}

// What /api/chat calls: the adapter, model, and key to use for this user's request.
// shared: true when it's Charla's own key, the only case where hedged duplicate requests are ok.
export async function resolveChatConfig(userId) {
  const { provider, models, keys } = await loadSettings(userId);
  const adapter = PROVIDERS[provider];
  const ownKey = ownKeyFor(keys, provider);
  if (provider === DEFAULT_PROVIDER && !ownKey) {
    if (!SERVER_GEMINI_KEY) throw new ProviderError("Server is missing GEMINI_API_KEY", { status: 500 });
    // The shared free-tier key always runs the default model — its rate limits are per-model.
    return { adapter, model: adapter.defaultModel, apiKey: SERVER_GEMINI_KEY, shared: true };
  }
  if (!ownKey) throw new ProviderError("Server is missing KEY_ENCRYPTION_SECRET", { status: 500 });
  return { adapter, model: models[provider] || adapter.defaultModel, apiKey: ownKey, shared: false };
}

// Voice always runs on Gemini (it's the only provider with speech models wired in): the user's own
// Gemini key if they saved one, otherwise the shared key. The real-time conversation is a Gemini
// model answering the learner directly, so it's only offered when Gemini is their chosen provider;
// with any other provider, that provider writes the replies and Gemini only reads them aloud.
export async function resolveVoiceConfig(userId) {
  const { provider, keys } = await loadSettings(userId);
  const gemini = PROVIDERS.gemini;
  const ownKey = ownKeyFor(keys, gemini.id);
  return { apiKey: ownKey || SERVER_GEMINI_KEY, liveAllowed: provider === gemini.id, liveModel: gemini.liveModel };
}

function publicSettings({ provider, models, keys }) {
  return {
    provider,
    usingFreeTier: provider === DEFAULT_PROVIDER && !keys[DEFAULT_PROVIDER],
    keysEnabled: Boolean(CIPHER_KEY),
    providers: Object.values(PROVIDERS).map((p) => ({
      id: p.id,
      label: p.label,
      keyUrl: p.keyUrl,
      defaultModel: p.defaultModel,
      suggestedModels: p.suggestedModels,
      model: models[p.id] || "",
      keyHint: keys[p.id]?.key_hint || null,
    })),
  };
}

const router = express.Router();

router.use(async (req, res, next) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });
  req.user = user;
  next();
});

router.get("/settings", async (req, res) => {
  try {
    res.json(publicSettings(await loadSettings(req.user.id)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Body: { provider, model? } — switches the active provider and/or sets its model ("" = default).
router.put("/settings", async (req, res) => {
  const { provider, model } = req.body;
  if (!PROVIDERS[provider]) return res.status(400).json({ error: "Unknown provider" });
  if (model != null && (typeof model !== "string" || model.length > 120)) return res.status(400).json({ error: "Invalid model" });
  try {
    const current = await loadSettings(req.user.id);
    if (provider !== DEFAULT_PROVIDER && !current.keys[provider]) {
      return res.status(400).json({ error: "Add an API key for this provider first" });
    }
    const models = { ...current.models };
    if (model != null) {
      if (model.trim()) models[provider] = model.trim();
      else delete models[provider];
    }
    await pool.query(
      `INSERT INTO ai_settings (user_id, provider, models, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE SET provider = $2, models = $3, updated_at = now()`,
      [req.user.id, provider, JSON.stringify(models)]
    );
    res.json(publicSettings(await loadSettings(req.user.id)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Body: { apiKey } — checks the key with the provider before storing it.
// Each save makes an outbound call to check the key, so it gets a small budget too.
router.put("/keys/:provider", rateLimit("keys", { burst: 10, perMinute: 3 }), async (req, res) => {
  const adapter = PROVIDERS[req.params.provider];
  if (!adapter) return res.status(400).json({ error: "Unknown provider" });
  if (!CIPHER_KEY) return res.status(500).json({ error: "Server is missing KEY_ENCRYPTION_SECRET" });
  const apiKey = typeof req.body.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!apiKey || apiKey.length > 500) return res.status(400).json({ error: "Missing API key" });
  try {
    if (!(await adapter.validateKey(apiKey))) {
      return res.status(400).json({ error: `${adapter.label} rejected that key — double-check it and try again.` });
    }
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
  try {
    await pool.query(
      `INSERT INTO ai_keys (user_id, provider, key_enc, key_hint, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id, provider) DO UPDATE SET key_enc = $3, key_hint = $4, updated_at = now()`,
      [req.user.id, adapter.id, encrypt(apiKey), apiKey.slice(-4)]
    );
    res.json(publicSettings(await loadSettings(req.user.id)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

router.delete("/keys/:provider", async (req, res) => {
  if (!PROVIDERS[req.params.provider]) return res.status(400).json({ error: "Unknown provider" });
  try {
    await pool.query(`DELETE FROM ai_keys WHERE user_id = $1 AND provider = $2`, [req.user.id, req.params.provider]);
    res.json(publicSettings(await loadSettings(req.user.id)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
