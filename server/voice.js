import express from "express";
import { getSessionUser } from "./auth.js";
import { resolveVoiceConfig } from "./ai.js";

// Gemini's prebuilt voices. Characters pick one; anything else falls back to the default.
const VOICES = new Set(["Kore", "Puck", "Aoede", "Charon", "Leda", "Fenrir"]);
const DEFAULT_VOICE = "Kore";
const TTS_MODEL = "gemini-3.8-flash-lite-tts";
// Streamed TTS normally starts in ~2s; past this the client falls back to the browser's voice.
const TTS_FIRST_AUDIO_TIMEOUT_MS = 8000;

// The free tier allows only a handful of TTS requests per day. Once a key is rate-limited, stop
// calling upstream for a while so every 🔊 tap fails fast and the client uses the browser voice.
const TTS_COOLDOWN_MS = 10 * 60000;
const ttsBlockedUntil = new Map(); // apiKey → timestamp

const STYLES = {
  normal: "Warm and natural, speaking slowly and clearly to a beginner Spanish learner.",
  slow: "Very slowly and clearly, with a small pause between words, for a beginner Spanish learner.",
};

const router = express.Router();

router.use(async (req, res, next) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });
  req.user = user;
  next();
});

// Body: { text, voice?, slow? } — streams back raw 16-bit mono PCM at 24 kHz as it's synthesized,
// so playback starts on the first chunk instead of waiting for the whole clip.
router.post("/tts", async (req, res) => {
  const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
  if (!text || text.length > 800) return res.status(400).json({ error: "Text must be 1-800 characters" });
  const voice = VOICES.has(req.body.voice) ? req.body.voice : DEFAULT_VOICE;

  let apiKey;
  try {
    ({ apiKey } = await resolveVoiceConfig(req.user.id));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Database error" });
  }
  if (!apiKey) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY" });
  if ((ttsBlockedUntil.get(apiKey) || 0) > Date.now()) return res.status(503).json({ error: "Speech generation is rate-limited" });

  const controller = new AbortController();
  res.on("close", () => controller.abort()); // the learner tapped something else — stop paying for audio
  const firstAudioTimer = setTimeout(() => controller.abort(), TTS_FIRST_AUDIO_TIMEOUT_MS);

  try {
    const upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: TTS_MODEL,
        input: [{
          type: "user_input",
          content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style: req.body.slow ? STYLES.slow : STYLES.normal }] }],
        }],
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice }] },
        stream: true,
      }),
    });
    if (!upstream.ok) {
      clearTimeout(firstAudioTimer);
      const detail = await upstream.text().catch(() => "");
      console.warn(`TTS failed (${upstream.status}): ${detail.slice(0, 300)}`);
      if (upstream.status === 429) ttsBlockedUntil.set(apiKey, Date.now() + TTS_COOLDOWN_MS);
      return res.status(502).json({ error: "Speech generation failed" });
    }

    // Server-sent events; audio arrives as base64 PCM in step.delta events with delta.type "audio".
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, "");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const event = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const line = event.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        let data;
        try { data = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (data.delta?.type !== "audio" || !data.delta.data) continue;
        if (!res.headersSent) {
          clearTimeout(firstAudioTimer);
          res.writeHead(200, { "Content-Type": "audio/l16; rate=24000; channels=1", "Cache-Control": "no-store" });
        }
        res.write(Buffer.from(data.delta.data, "base64"));
      }
    }
    clearTimeout(firstAudioTimer);
    if (!res.headersSent) return res.status(502).json({ error: "Speech generation returned no audio" });
    res.end();
  } catch (err) {
    clearTimeout(firstAudioTimer);
    if (res.headersSent) return res.end(); // mid-stream: the client plays what it got
    if (err.name === "AbortError") {
      if (!res.writableEnded && !req.destroyed) res.status(504).json({ error: "Speech generation timed out" });
      return;
    }
    console.error(err);
    res.status(502).json({ error: "Speech generation failed" });
  }
});

// Body: { systemInstruction, voice? } — mints a single-use, short-lived token for one real-time
// conversation. The browser then talks to Gemini Live directly (no audio relayed through this
// server), and the token's locked setup means it can't be reused for a different model or prompt.
router.post("/live", async (req, res) => {
  const systemInstruction = typeof req.body.systemInstruction === "string" ? req.body.systemInstruction : "";
  if (!systemInstruction || systemInstruction.length > 30000) return res.status(400).json({ error: "Invalid system instruction" });
  const voice = VOICES.has(req.body.voice) ? req.body.voice : DEFAULT_VOICE;

  let config;
  try {
    config = await resolveVoiceConfig(req.user.id);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Database error" });
  }
  if (!config.liveAllowed) return res.status(403).json({ error: "Live voice is only available with Gemini", kind: "not-gemini" });
  if (!config.apiKey) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY" });

  const now = Date.now();
  try {
    const upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
      method: "POST",
      headers: { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        uses: 1,
        expireTime: new Date(now + 30 * 60000).toISOString(),
        newSessionExpireTime: new Date(now + 60000).toISOString(),
        bidiGenerateContentSetup: {
          model: `models/${config.liveModel}`,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
          systemInstruction: { parts: [{ text: systemInstruction }] },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          // Beginners pause mid-sentence to find words — wait longer than the default before
          // deciding they've finished. Tapping the stop button still ends the turn instantly.
          realtimeInputConfig: { automaticActivityDetection: { endOfSpeechSensitivity: "END_SENSITIVITY_LOW", silenceDurationMs: 1500 } },
          contextWindowCompression: { slidingWindow: {} },
        },
      }),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok || !data.name) {
      console.warn(`Live token mint failed (${upstream.status}): ${JSON.stringify(data).slice(0, 300)}`);
      return res.status(502).json({ error: data.error?.message || "Couldn't start the voice session" });
    }
    res.json({ token: data.name, model: config.liveModel });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Couldn't start the voice session" });
  }
});

export default router;
