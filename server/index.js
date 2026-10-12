import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "..", "dist");

const PORT = process.env.PORT || 8787;
const API_KEY = process.env.GEMINI_API_KEY;
// gemini-3-flash-preview defaults to heavy "thinking" (multi-second latency) and is prone to
// 503s under free-tier load. gemini-3.1-flash-lite skips extended thinking by default, responds
// in ~2-3s, and held up fine in testing — much better fit for a live voice conversation.
const MODEL = "gemini-3.1-flash-lite";

if (!API_KEY) {
  console.warn("GEMINI_API_KEY is not set — copy .env.example to .env and add your key.");
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));

// Client sends Anthropic-shaped { role, content } messages (content is a string,
// or an array of {type:"text", text} / {type:"image", source:{media_type, data}} blocks).
// Translate that into Gemini's {role, parts} contents shape.
function toGeminiContents(messages) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: (Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }]).map((block) => {
      if (block.type === "image") {
        return { inline_data: { mime_type: block.source.media_type, data: block.source.data } };
      }
      return { text: block.text };
    }),
  }));
}

async function callGemini(body) {
  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  const data = await upstream.json();
  return { ok: upstream.ok, status: upstream.status, data };
}

app.post("/api/chat", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: "Server is missing GEMINI_API_KEY" });
  }
  const body = {
    contents: toGeminiContents(req.body.messages),
    generationConfig: { maxOutputTokens: 1000 },
  };
  try {
    let result = await callGemini(body);
    // The free-tier model occasionally returns a transient 503 under load — one retry clears most of those.
    if (!result.ok && result.data?.error?.status === "UNAVAILABLE") {
      await new Promise((r) => setTimeout(r, 1200));
      result = await callGemini(body);
    }
    if (!result.ok) {
      const message = result.data?.error?.message || `Gemini request failed (${result.status})`;
      return res.status(result.status).json({ error: message });
    }
    const text = (result.data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n");
    if (!text) {
      return res.status(502).json({ error: "Model returned an empty response" });
    }
    res.json({ text });
  } catch (err) {
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

app.listen(PORT, () => {
  console.log(`Charla listening on http://localhost:${PORT}`);
});
