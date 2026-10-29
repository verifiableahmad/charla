/* ---------- Voice engine ----------
   speak()       Gemini TTS streamed from /api/voice/tts, falling back to the browser's
                 speechSynthesis if it fails, is slow, or the shared key's small daily TTS quota is spent.
   LiveSession   Real-time spoken conversation with Gemini Live: mic → 16 kHz PCM → WebSocket,
                 reply audio streamed straight back. Used by Hablar when Gemini is the provider.
------------------------------------------- */

/* ---------- Playback: one AudioContext, PCM chunks scheduled back-to-back as they stream in ---------- */
let ctx = null;
export function audioContext() {
  if (!ctx) {
    const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// iOS only lets audio start inside a user gesture, and replies land after a network round trip —
// so resume the context on every tap (cheap, and iOS can re-suspend it in the background).
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => audioContext(), { capture: true });
}

const player = {
  out: null,
  nextTime: 0,
  sources: new Set(),
  leftover: null,

  // bytes: 16-bit little-endian mono PCM. Network chunks can split a sample, so a stray odd
  // byte is carried over to the next push.
  push(bytes, rate = 24000) {
    const c = audioContext();
    if (!c) return;
    let data = bytes;
    if (this.leftover) {
      data = new Uint8Array(this.leftover.length + bytes.length);
      data.set(this.leftover);
      data.set(bytes, this.leftover.length);
      this.leftover = null;
    }
    if (data.length % 2) {
      this.leftover = data.slice(-1);
      data = data.subarray(0, data.length - 1);
    }
    if (!data.length) return;
    if (!this.out) {
      this.out = c.createGain();
      this.out.connect(c.destination);
    }
    const samples = new Int16Array(data.slice().buffer);
    const buffer = c.createBuffer(1, samples.length, rate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.connect(this.out);
    // A little lead time on the first chunk absorbs network jitter between the next few.
    const start = Math.max(this.nextTime, c.currentTime + 0.08);
    src.start(start);
    this.nextTime = start + buffer.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  },

  // A short fade instead of a hard cut — cutting a waveform mid-cycle is an audible click.
  stop() {
    const out = this.out;
    const sources = [...this.sources];
    this.out = null;
    this.sources.clear();
    this.nextTime = 0;
    this.leftover = null;
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    out.gain.setValueAtTime(out.gain.value, t);
    out.gain.linearRampToValueAtTime(0, t + 0.03);
    sources.forEach((s) => { try { s.stop(t + 0.04); } catch {} });
    setTimeout(() => out.disconnect(), 100);
  },
};

/* ---------- Browser speech: the fallback voice ---------- */
let esVoice = null;
function pickVoice() {
  try {
    const es = speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith("es"));
    // Network voices (Chrome's "Google español", Edge's "Natural" voices) sound far more natural
    // than the default offline OS voice that speechSynthesis otherwise falls back to.
    const byQuality = (v) => (/google/i.test(v.name) ? 2 : /natural|neural|enhanced|premium/i.test(v.name) ? 1 : 0);
    const byRegion = (v) => (/es[-_](MX|US|419)/i.test(v.lang) ? 1 : 0);
    esVoice = es.sort((a, b) => (byQuality(b) - byQuality(a)) || (byRegion(b) - byRegion(a)))[0] || null;
  } catch {}
}
if (typeof speechSynthesis !== "undefined") {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

let speakSeq = 0;
function speakBrowser(text, rate) {
  try {
    if (!esVoice) pickVoice(); // voices sometimes become available before onvoiceschanged fires
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = esVoice?.lang || "es-MX";
    if (esVoice) u.voice = esVoice;
    u.rate = rate;
    // Chrome leaves the TTS audio stream open for a beat after onend, which makes the OS
    // emit an audible pop when it's finally torn down — force an immediate close instead.
    u.onend = () => speechSynthesis.cancel();
    // Chrome can silently drop an utterance queued in the same tick as cancel() — give it a beat.
    const seq = speakSeq;
    setTimeout(() => { if (seq === speakSeq) speechSynthesis.speak(u); }, 60);
  } catch {}
}

/* ---------- speak(): Gemini TTS with browser fallback ---------- */
export const DEFAULT_VOICE = "Kore";
let characterVoice = DEFAULT_VOICE;
// Hablar and Mensajes set this so a character keeps the same voice; null restores the default.
export function setCharacterVoice(voice) { characterVoice = voice || DEFAULT_VOICE; }

// Learner-provided text (e.g. a scanned photo) only goes to Google for speech when Gemini is
// already their provider — otherwise it's read by the browser's voice.
let geminiProvider = false;
export function setVoiceProvider(provider) { geminiProvider = provider === "gemini"; }

// Emoji would be read out by name ("cara sonriente") — contacts' texts can include them.
const cleanForSpeech = (text) =>
  String(text || "").replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}‍️]/gu, "").replace(/\s+/g, " ").trim();

// Replays (🔊 again, flashcards) come back instantly from here instead of re-synthesizing.
const ttsCache = new Map();
const TTS_CACHE_SIZE = 60;
let ttsAbort = null;

export function speak(text, rate = 0.95, { own = false } = {}) {
  const clean = cleanForSpeech(text);
  if (!clean) return;
  hush();
  const seq = speakSeq;
  if (own && !geminiProvider) return speakBrowser(clean, rate);
  const slow = rate <= 0.7;
  const key = `${characterVoice}|${slow}|${clean}`;
  const cached = ttsCache.get(key);
  if (cached) {
    ttsCache.delete(key);
    ttsCache.set(key, cached); // refresh LRU position
    cached.forEach((chunk) => player.push(chunk));
    return;
  }
  const controller = new AbortController();
  ttsAbort = controller;
  (async () => {
    const chunks = [];
    try {
      const res = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, voice: characterVoice, slow }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`TTS ${res.status}`);
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (seq !== speakSeq) return;
        chunks.push(value);
        player.push(value);
      }
      ttsCache.set(key, chunks);
      if (ttsCache.size > TTS_CACHE_SIZE) ttsCache.delete(ttsCache.keys().next().value);
    } catch {
      if (seq !== speakSeq) return; // hushed or superseded — not a failure
      if (!chunks.length) speakBrowser(clean, rate);
    }
  })();
}

export function hush() {
  speakSeq++;
  ttsAbort?.abort();
  ttsAbort = null;
  player.stop();
  try { speechSynthesis.cancel(); } catch {}
}

/* ---------- Live: real-time conversation ---------- */
const LIVE_WS = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

export const liveSupported = () =>
  typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined" && "WebSocket" in window;

// Runs on the audio thread: downsamples the mic to 16 kHz 16-bit PCM (what Live expects) and
// posts 100 ms chunks. Averaging each window doubles as a cheap low-pass filter.
const CAPTURE_WORKLET = `
class Pcm16k extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.t = 0; this.acc = 0; this.n = 0; this.out = new Int16Array(1600); this.len = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.n++; this.t++;
      if (this.t >= this.ratio) {
        this.t -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.acc / this.n));
        this.out[this.len++] = v < 0 ? v * 32768 : v * 32767;
        this.acc = 0; this.n = 0;
        if (this.len === this.out.length) { this.port.postMessage(this.out.buffer, [this.out.buffer]); this.out = new Int16Array(1600); this.len = 0; }
      }
    }
    return true;
  }
}
registerProcessor("pcm16k", Pcm16k);`;
let workletReady = null;

function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export class LiveSession {
  // getSetup() → { systemInstruction, voice }, called on every (re)connect so a reconnect carries
  // the conversation so far. onEvent(type, payload) with type one of:
  //   "talking" (bool) · "thinking" · "user" (transcript so far) · "ai" (transcript so far) ·
  //   "turn" ({ user, ai }) · "error" (Error, with .kind "not-gemini" when Live isn't allowed)
  constructor({ getSetup, onEvent }) {
    this.getSetup = getSetup;
    this.onEvent = onEvent;
    this.ws = null;
    this.ready = null;
    this.talking = false;
    this.closed = false;
    this.setupDone = false;
    this.pending = []; // mic chunks captured before the session was ready
    this.resetTurn();
  }

  resetTurn() {
    this.userText = "";
    this.aiText = "";
    this.aiActive = false;
    this.dropAudio = false;
  }

  emit(type, payload) {
    try { this.onEvent(type, payload); } catch (err) { console.error(err); }
  }

  connect() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const { systemInstruction, voice } = this.getSetup();
      const res = await fetch("/api/voice/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemInstruction, voice }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || "Couldn't start the voice session"), { kind: data.kind });
      if (this.closed) throw new Error("closed");
      const ws = new WebSocket(`${LIVE_WS}?access_token=${encodeURIComponent(data.token)}`);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error("The voice session took too long to start")); ws.close(); }, 10000);
        ws.onopen = () => ws.send(JSON.stringify({ setup: { model: `models/${data.model}` } }));
        ws.onmessage = (ev) => {
          if (parseMessage(ev)?.setupComplete) { clearTimeout(timer); resolve(); }
        };
        ws.onclose = (ev) => { clearTimeout(timer); reject(new Error(ev.reason || "The voice session closed")); };
      });
      this.setupDone = true;
      ws.onmessage = (ev) => this.handle(parseMessage(ev));
      // Sessions end on their own (token expiry, idle, server goAway); the next tap reconnects.
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.ready = null;
        this.setupDone = false;
        if (this.talking) this.stopTalking();
        this.resetTurn();
      };
    })();
    this.ready.catch(() => { this.ready = null; this.ws = null; });
    return this.ready;
  }

  handle(msg) {
    if (!msg) return;
    if (msg.voiceActivity?.type === "ACTIVITY_START") this.heardSpeech = true;
    // Server-side end-of-speech: close the mic for them, like the old push-to-talk auto-stop.
    if (msg.voiceActivity?.type === "ACTIVITY_END" && this.talking) this.stopTalking();
    const sc = msg.serverContent;
    if (!sc) return;
    if (sc.inputTranscription?.text) {
      this.userText += sc.inputTranscription.text;
      this.emit("user", this.userText.trim());
    }
    if (sc.outputTranscription?.text) {
      this.aiText += sc.outputTranscription.text;
      this.emit("ai", this.aiText.trim());
    }
    for (const part of sc.modelTurn?.parts || []) {
      if (!part.inlineData?.data) continue;
      this.aiActive = true;
      if (!this.dropAudio) player.push(fromBase64(part.inlineData.data), 24000);
    }
    if (sc.interrupted) this.dropAudio = false; // the old reply is cancelled; the next one should play
    if (sc.turnComplete) {
      const turn = { user: this.userText.trim(), ai: this.aiText.trim() };
      this.resetTurn();
      if (turn.ai) this.emit("turn", turn);
    }
  }

  async startTalking() {
    if (this.talking) return;
    hush(); // the learner is cutting in — stop whatever is playing
    if (this.aiActive) this.dropAudio = true; // and ignore the rest of the reply still in flight
    this.talking = true;
    this.heardSpeech = false;
    this.pending = [];
    this.emit("talking", true);
    // Capture starts at the tap and is buffered until the session is ready. Waiting for the session
    // first lost the learner's opening words whenever it had to (re)connect (~1.5s).
    const connecting = this.connect();
    connecting.catch(() => {}); // surfaced below, once the mic is up
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      this.stream = stream;
      if (!this.talking) return this.releaseMic();
      const c = audioContext();
      workletReady ??= c.audioWorklet
        .addModule(URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" })))
        .catch((err) => { workletReady = null; throw err; });
      await workletReady;
      if (!this.talking) return this.releaseMic();
      this.source = c.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(c, "pcm16k");
      this.node.port.onmessage = (e) => {
        if (!this.talking) return;
        const msg = JSON.stringify({ realtimeInput: { audio: { data: toBase64(new Uint8Array(e.data)), mimeType: "audio/pcm;rate=16000" } } });
        // The socket can close mid-turn (idle, token expiry); keep buffering until the reconnect.
        if (this.setupDone && this.ws && !this.pending.length) this.ws.send(msg);
        else this.pending.push(msg);
      };
      // Some browsers only pull audio through a worklet that's connected onward — route it to a muted sink.
      this.sink = c.createGain();
      this.sink.gain.value = 0;
      this.source.connect(this.node);
      this.node.connect(this.sink);
      this.sink.connect(c.destination);
      await connecting;
      this.flushPending();
    } catch (err) {
      this.talking = false;
      this.releaseMic();
      this.emit("talking", false);
      this.emit("error", err);
    }
  }

  stopTalking() {
    if (!this.talking) return;
    this.talking = false;
    this.releaseMic();
    this.emit("talking", false);
    // Still connecting: flushPending() sends the buffered speech and the end marker once it's ready.
    if (!this.setupDone || !this.ws || this.pending.length) return;
    // Tells Live the learner is done, so it answers now instead of waiting out the silence timer.
    this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    if (this.heardSpeech) this.emit("thinking");
  }

  flushPending() {
    if (!this.setupDone) return;
    const buffered = this.pending.length;
    this.pending.forEach((msg) => this.ws.send(msg));
    this.pending = [];
    // They already tapped stop while it was connecting — end the turn now that the audio is in.
    if (!this.talking) {
      this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      if (buffered >= 5) this.emit("thinking"); // ≥0.5s of audio — otherwise it was likely just a tap
    }
  }

  // Microphone is released between turns — holding it open makes iOS route playback to the earpiece.
  releaseMic() {
    try { this.source?.disconnect(); this.node?.disconnect(); this.sink?.disconnect(); } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source = this.node = this.sink = this.stream = null;
  }

  async sendText(text) {
    hush();
    if (this.aiActive) this.dropAudio = true;
    try {
      await this.connect();
      this.userText = text;
      this.ws.send(JSON.stringify({ realtimeInput: { text } }));
      this.emit("thinking");
    } catch (err) {
      this.emit("error", err);
    }
  }

  close() {
    this.closed = true;
    this.talking = false;
    this.releaseMic();
    const ws = this.ws;
    this.ws = null;
    this.ready = null;
    this.setupDone = false;
    this.pending = [];
    try { ws?.close(); } catch {}
  }
}

function parseMessage(ev) {
  try {
    return JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data));
  } catch {
    return null;
  }
}
