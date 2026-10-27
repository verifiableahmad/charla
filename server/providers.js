import Anthropic from "@anthropic-ai/sdk";

// Every adapter takes the client's Anthropic-shaped { role, content } messages (content is a
// string, or an array of {type:"text", text} / {type:"image", source:{media_type, data}} blocks)
// and returns the reply text. Failures throw ProviderError so /api/chat can tell the client
// *why* — a rejected key or an empty balance needs a different message than a network blip.
export class ProviderError extends Error {
  // kind: "auth" (key rejected), "quota" (out of credit / rate limited), "model" (no such model),
  // "upstream" (anything else)
  constructor(message, { status = 502, kind = "upstream" } = {}) {
    super(message);
    this.status = status;
    this.kind = kind;
  }
}

const blocksOf = (m) => (Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }]);
const dataUrl = (block) => `data:${block.source.media_type};base64,${block.source.data}`;

// Without a ceiling, one stalled upstream request leaves the learner on "Pensando…" forever —
// free-tier Gemini was seen hanging for minutes. Past this, fail fast so the retry button shows.
const REQUEST_TIMEOUT_MS = 20000;

async function postJson(url, headers, body, { signal } = {}) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const data = await upstream.json().catch(() => ({}));
    return { ok: upstream.ok, status: upstream.status, data };
  } catch (err) {
    if (err.name !== "TimeoutError" && err.name !== "AbortError") throw err;
    return { ok: false, status: 504, data: { error: { message: "The AI took too long to answer — try again." } } };
  }
}

async function keyAccepted(url, headers) {
  const res = await fetch(url, { headers });
  if (res.ok) return true;
  if (res.status === 401 || res.status === 403 || res.status === 400) return false;
  throw new ProviderError(`Couldn't check the key right now (${res.status}) — try again in a moment.`);
}

/* ---------- Google Gemini ---------- */
function toGeminiContents(messages) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: blocksOf(m).map((block) =>
      block.type === "image" ? { inline_data: { mime_type: block.source.media_type, data: block.source.data } } : { text: block.text }
    ),
  }));
}

// Generation itself takes ~1s, but Gemini queues requests before starting them: the same request
// measured anywhere from 1.2s to 30s+, and which model was fast flipped within minutes. So if the
// first attempt hasn't answered after HEDGE_AFTER_MS (or fails fast with a capacity error), fire a
// second one — on a different model when possible, since capacity and per-model rate limits are
// separate — and take whichever lands first.
const HEDGE_AFTER_MS = 4000;
const HEDGE_MODEL = "gemini-3.5-flash";
const retriable = (r) => !r.ok && [429, 500, 503, 504].includes(r.status);

function hedged(primary, backup) {
  return new Promise((resolve) => {
    const controllers = [];
    const results = [];
    let settled = false;
    let timer;
    const launch = (attempt) => {
      const controller = new AbortController();
      controllers.push(controller);
      const index = results.length;
      results.push(undefined);
      attempt(controller.signal).then((result) => {
        results[index] = result;
        if (settled) return;
        if (result.ok || (controllers.length === 2 && results.every(Boolean))) {
          settled = true;
          clearTimeout(timer);
          controllers.forEach((c) => c.abort());
          // Both failed: report the primary's error, it's the model the user actually picked.
          resolve(result.ok ? result : results[0]);
        } else if (controllers.length === 1 && retriable(result)) {
          clearTimeout(timer);
          launch(backup);
        } else if (controllers.length === 1) {
          settled = true;
          resolve(result);
        }
      });
    };
    launch(primary);
    timer = setTimeout(() => !settled && controllers.length === 1 && launch(backup), HEDGE_AFTER_MS);
  });
}

const gemini = {
  id: "gemini",
  label: "Google Gemini",
  defaultModel: "gemini-3.1-flash-lite",
  suggestedModels: ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.8-flash"],
  keyUrl: "https://aistudio.google.com/apikey",
  // Model for the real-time voice conversation (Live API) — separate from the text model above.
  liveModel: "gemini-3.8-live",
  async chat({ messages, model, apiKey, json }) {
    const call = (m) => (signal) =>
      postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`,
        { "x-goog-api-key": apiKey },
        {
          contents: toGeminiContents(messages),
          generationConfig: {
            // Thinking tokens count against this limit, and a truncated reply is unparseable JSON.
            maxOutputTokens: 2000,
            // JSON mode stops the model wrapping replies in fences or prose that breaks parsing.
            ...(json && { responseMimeType: "application/json" }),
            // Gemini 3 Flash models think by default; these short replies don't need it.
            ...(/^gemini-3.*flash/.test(m) && { thinkingConfig: { thinkingLevel: "minimal" } }),
          },
        },
        { signal }
      );
    const result = await hedged(call(model), call(model === gemini.defaultModel ? HEDGE_MODEL : model));
    if (!result.ok) {
      const err = result.data?.error || {};
      const message = err.message || `Gemini request failed (${result.status})`;
      if (err.details?.some((d) => d.reason === "API_KEY_INVALID") || result.status === 403) {
        throw new ProviderError(message, { status: 400, kind: "auth" });
      }
      if (result.status === 429) throw new ProviderError(message, { status: 429, kind: "quota" });
      throw new ProviderError(message, { status: result.status, kind: result.status === 404 ? "model" : "upstream" });
    }
    return (result.data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n");
  },
  validateKey: (apiKey) =>
    keyAccepted("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { "x-goog-api-key": apiKey }),
};

/* ---------- OpenAI (Responses API) ---------- */
// Built on the Responses API rather than Chat Completions because that's the only endpoint
// "Sign in with ChatGPT" plan usage supports — a future ChatGPT-login provider can reuse this.
function toOpenAIInput(messages) {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: m.content.map((block) =>
        block.type === "image"
          ? { type: "input_image", image_url: dataUrl(block) }
          : { type: m.role === "assistant" ? "output_text" : "input_text", text: block.text }
      ),
    };
  });
}

const openai = {
  id: "openai",
  label: "OpenAI",
  defaultModel: "gpt-6-luna",
  suggestedModels: ["gpt-6-luna", "gpt-6.1-sol"],
  keyUrl: "https://platform.openai.com/api-keys",
  async chat({ messages, model, apiKey }) {
    const result = await postJson(
      "https://api.openai.com/v1/responses",
      { Authorization: `Bearer ${apiKey}` },
      {
        model,
        input: toOpenAIInput(messages),
        // Luna is the only current model that accepts "none"; the rest bottom out at "low".
        // Reasoning tokens count toward max_output_tokens, hence the headroom.
        reasoning: { effort: /luna/.test(model) ? "none" : "low" },
        max_output_tokens: 4000,
        store: false,
      }
    );
    if (!result.ok) {
      const message = result.data?.error?.message || `OpenAI request failed (${result.status})`;
      if (result.status === 401 || result.status === 403) throw new ProviderError(message, { status: 400, kind: "auth" });
      if (result.status === 429) throw new ProviderError(message, { status: 429, kind: "quota" });
      throw new ProviderError(message, { status: result.status, kind: result.status === 404 ? "model" : "upstream" });
    }
    return (result.data.output || [])
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content || [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text)
      .join("");
  },
  validateKey: (apiKey) => keyAccepted("https://api.openai.com/v1/models", { Authorization: `Bearer ${apiKey}` }),
};

/* ---------- Anthropic Claude ---------- */
// Current-generation Claude models take output_config.effort; "low" keeps chat replies quick.
const CLAUDE_GEN5 = /^claude-(fable|opus|sonnet|haiku)-5/;
// Models that accept the server-side refusal fallback (Haiku has none).
const CLAUDE_FALLBACK = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;

const anthropic = {
  id: "anthropic",
  label: "Anthropic Claude",
  defaultModel: "claude-opus-5-5",
  suggestedModels: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  keyUrl: "https://platform.claude.com/settings/keys",
  async chat({ messages, model, apiKey }) {
    // The SDK's default timeout is 10 minutes — far too long for someone waiting mid-conversation.
    const client = new Anthropic({ apiKey, timeout: 30000, maxRetries: 1 });
    const params = {
      model,
      max_tokens: 16000,
      messages,
      ...(CLAUDE_GEN5.test(model) && { output_config: { effort: "low" } }),
    };
    let response;
    try {
      response = CLAUDE_FALLBACK.test(model)
        ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
        : await client.messages.create(params);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new ProviderError(err.message, { status: 400, kind: "auth" });
      }
      if (err instanceof Anthropic.RateLimitError) throw new ProviderError(err.message, { status: 429, kind: "quota" });
      if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) {
        throw new ProviderError(err.message, { status: 402, kind: "quota" });
      }
      if (err instanceof Anthropic.NotFoundError) throw new ProviderError(err.message, { status: 404, kind: "model" });
      if (err instanceof Anthropic.APIError) throw new ProviderError(err.message, { status: err.status || 502 });
      throw err;
    }
    if (response.stop_reason === "refusal") {
      throw new ProviderError("Claude declined to answer that one.", { status: 422 });
    }
    return response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  },
  async validateKey(apiKey) {
    try {
      await new Anthropic({ apiKey, maxRetries: 0 }).models.list({ limit: 1 });
      return true;
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return false;
      throw new ProviderError(`Couldn't check the key right now — try again in a moment.`);
    }
  },
};

/* ---------- OpenRouter (one key, models from every lab) ---------- */
const openrouter = {
  id: "openrouter",
  label: "OpenRouter",
  defaultModel: "openai/gpt-6-luna",
  suggestedModels: ["openai/gpt-6-luna", "anthropic/claude-haiku-5.5", "google/gemini-3.8-flash"],
  keyUrl: "https://openrouter.ai/settings/keys",
  async chat({ messages, model, apiKey }) {
    const result = await postJson(
      "https://openrouter.ai/api/v1/chat/completions",
      { Authorization: `Bearer ${apiKey}`, "X-Title": "Charla" },
      {
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: Array.isArray(m.content)
            ? m.content.map((block) =>
                block.type === "image" ? { type: "image_url", image_url: { url: dataUrl(block) } } : { type: "text", text: block.text }
              )
            : m.content,
        })),
        reasoning: { effort: "low" },
        max_tokens: 4000,
      }
    );
    if (!result.ok) {
      const message = result.data?.error?.message || `OpenRouter request failed (${result.status})`;
      if (result.status === 401 || result.status === 403) throw new ProviderError(message, { status: 400, kind: "auth" });
      if (result.status === 402 || result.status === 429) throw new ProviderError(message, { status: result.status, kind: "quota" });
      throw new ProviderError(message, { status: result.status, kind: result.status === 404 ? "model" : "upstream" });
    }
    return result.data.choices?.[0]?.message?.content || "";
  },
  validateKey: (apiKey) => keyAccepted("https://openrouter.ai/api/v1/key", { Authorization: `Bearer ${apiKey}` }),
};

export const PROVIDERS = { gemini, openai, anthropic, openrouter };
export const DEFAULT_PROVIDER = "gemini";
