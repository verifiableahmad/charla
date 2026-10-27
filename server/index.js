import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import authRouter, { getSessionUser } from "./auth.js";
import dataRouter from "./data.js";
import aiRouter, { resolveChatConfig } from "./ai.js";
import voiceRouter from "./voice.js";
import { ProviderError } from "./providers.js";
import { ensureSchema } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "..", "dist");

const PORT = process.env.PORT || 8787;

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use("/api/auth", authRouter);
app.use("/api/data", dataRouter);
app.use("/api/ai", aiRouter);
app.use("/api/voice", voiceRouter);

app.post("/api/chat", async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: "Not signed in" });
  }
  try {
    const { adapter, model, apiKey } = await resolveChatConfig(user.id);
    const text = await adapter.chat({ messages: req.body.messages, model, apiKey, json: req.body.json === true });
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

// In production the built client ships in the same container — serve it from here so
// the deployed app is one service on one URL instead of two separately-hosted pieces.
app.use(express.static(DIST_DIR));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(DIST_DIR, "index.html"));
});

try {
  await ensureSchema();
} catch (err) {
  console.warn("Could not reach Postgres — sign-in will be unavailable until DATABASE_URL points to a reachable database.", err.message);
}
app.listen(PORT, () => {
  console.log(`Charla listening on http://localhost:${PORT}`);
});
