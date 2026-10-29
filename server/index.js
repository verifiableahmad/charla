import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import authRouter, { getSessionUser } from "./auth.js";
import dataRouter from "./data.js";
import aiRouter, { resolveChatConfig } from "./ai.js";
import voiceRouter from "./voice.js";
import { ProviderError } from "./providers.js";
import { ensureSchema, pruneSessions } from "./db.js";
import { rateLimit } from "./limits.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "..", "dist");

const PORT = process.env.PORT || 8787;

const app = express();
// Fly and Cloud Run terminate TLS in front of us; trust their X-Forwarded-* so req.protocol is right.
app.set("trust proxy", true);
// The biggest legitimate body is one scanned photo (≤1400px JPEG, ~1 MB as base64).
app.use(express.json({ limit: "4mb" }));
app.use("/api/auth", authRouter);
app.use("/api/data", dataRouter);
app.use("/api/ai", aiRouter);
app.use("/api/voice", voiceRouter);

// Only the shapes the app itself sends: a bounded conversation of text, plus at most one image.
const MAX_MESSAGES = 120;
const MAX_TEXT = 40000;
const MAX_TOTAL_TEXT = 160000;
const MAX_IMAGE_B64 = 3 * 1024 * 1024;
function validMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return false;
  let total = 0, images = 0;
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return false;
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    if (!Array.isArray(blocks) || blocks.length === 0) return false;
    for (const b of blocks) {
      if (b?.type === "text" && typeof b.text === "string" && b.text.length <= MAX_TEXT) total += b.text.length;
      else if (b?.type === "image" && m.role === "user" && typeof b.source?.data === "string" && b.source.data.length <= MAX_IMAGE_B64
               && /^image\/(jpeg|png|webp)$/.test(b.source.media_type || "")) images++;
      else return false;
    }
  }
  return total <= MAX_TOTAL_TEXT && images <= 1;
}

app.post("/api/chat", async (req, res, next) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });
  req.user = user;
  next();
}, rateLimit("chat", { burst: 30, perMinute: 12 }), async (req, res) => {
  if (!validMessages(req.body.messages)) return res.status(400).json({ error: "Invalid messages" });
  try {
    const { adapter, model, apiKey, shared } = await resolveChatConfig(req.user.id);
    const text = await adapter.chat({ messages: req.body.messages, model, apiKey, json: req.body.json === true, hedge: shared });
    if (!text) {
      return res.status(502).json({ error: "Model returned an empty response" });
    }
    res.json({ text });
  } catch (err) {
    if (err instanceof ProviderError) {
      // "kind" lets the client show "your key was rejected" instead of a generic connection error.
      return res.status(err.status).json({ error: err.message, kind: err.kind });
    }
    console.error(err);
    res.status(500).json({ error: "Upstream request failed" });
  }
});

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

// In production the built client ships in the same container — serve it from here so
// the deployed app is one service on one URL instead of two separately-hosted pieces.
app.use(express.static(DIST_DIR, { index: false }));

// Link previews need an absolute og:image URL; filling in this request's origin keeps it right
// on whichever host serves the app (Fly, Cloud Run, a custom domain).
let indexHtml = null;
app.get(/^(?!\/api).*/, (req, res) => {
  try {
    indexHtml ??= fs.readFileSync(path.join(DIST_DIR, "index.html"), "utf8");
  } catch {
    return res.status(404).send("Client not built — run `npm run build`, or use the Vite dev server.");
  }
  const origin = `${req.protocol}://${req.get("host")}`;
  res.type("html").send(indexHtml.replace(/content="\/og-image\.png"/g, `content="${origin}/og-image.png"`));
});

try {
  await ensureSchema();
} catch (err) {
  console.warn("Could not reach Postgres — sign-in will be unavailable until DATABASE_URL points to a reachable database.", err.message);
}
setInterval(() => pruneSessions().catch(() => {}), 60 * 60000).unref();
app.listen(PORT, () => {
  console.log(`Charla listening on http://localhost:${PORT}`);
});
