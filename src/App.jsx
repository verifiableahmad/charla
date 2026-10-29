import React, { useState, useEffect, useRef, useCallback, useContext, createContext, useReducer, useMemo } from "react";
import { speak, hush, setCharacterVoice, setVoiceProvider, liveSupported, LiveSession } from "./voice.js";
import { SceneArt, ART_KEYS } from "./sceneArt.jsx";
import { SyncedKey } from "./sync.js";
import { strip, DAY_MS as dayMs, schedule, nextInterval as nextReviewInterval, dueWhen, maskHint, sanitizeScene, normGloss, appendUser, dropTrailingError, removeChatFromProgress } from "./logic.js";

/* ---------- Charla · audio-first ----------
   Palette: ink navy, rosa mexicano, lime leaf, sun ivory
   Type: Outfit everywhere; Fraunces only for the "Charla." wordmark
   Signature: the big talk button. The whole app orbits around speaking.
   Voice of the copy: Spanish first, short, warm, plain. No em dashes, no emoji as icons.
------------------------------------------- */
const T = {
  ink: "#1B2145", rosa: "#D6336C", rosaDeep: "#B8285A", rosaSoft: "#FCE7F0",
  leaf: "#2E7D4F", leafSoft: "#E4F3E9",
  paper: "#FFFDF7", sand: "#F3EEE2", line: "#E5DFCE", dim: "#5F6380",
};

const SCENARIOS = [
  { id: "mercado", art: "market", voice: "female", voiceName: "Aoede", title: "En el mercado", titleEn: "At the market", goal: "Buy fruit and haggle a little", goalEs: "Compra fruta y regatea un poco", who: "Doña Rosa, a fruit vendor in Oaxaca", whoEs: "Doña Rosa, vende fruta en Oaxaca", opener: "¡Buenos días! Tengo mangos muy dulces hoy. ¿Qué buscas?", hint: "Good morning! I have very sweet mangoes today. What are you looking for?" },
  { id: "cafe", art: "cafe", voice: "male", voiceName: "Puck", title: "Café con un amigo nuevo", titleEn: "Coffee with a new friend", goal: "Talk about your real life: work, family, dreams", goalEs: "Habla de tu vida: trabajo, familia, sueños", who: "Mateo, a friendly porteño from Buenos Aires", whoEs: "Mateo, un porteño muy simpático", opener: "¡Hola! Qué bueno verte. Cuéntame, ¿qué haces en tu vida? ¿Trabajas o estudias?", hint: "Hi! So good to see you. Tell me, what do you do in life? Do you work or study?" },
  { id: "perdido", art: "street", voice: "female", voiceName: "Leda", title: "Perdido en Madrid", titleEn: "Lost in Madrid", goal: "Ask for directions and help", goalEs: "Pregunta cómo llegar y pide ayuda", who: "Lucía, a madrileña waiting for the bus", whoEs: "Lucía, una madrileña que espera el autobús", opener: "Perdona, ¿estás perdido? ¿A dónde quieres ir?", hint: "Excuse me, are you lost? Where do you want to go?" },
  { id: "dia", art: "evening", voice: "female", voiceName: "Kore", title: "¿Cómo fue tu día?", titleEn: "How was your day?", goal: "Tell the story of your actual day", goalEs: "Cuenta cómo fue tu día de verdad", who: "Camila, your conversation buddy", whoEs: "Camila, tu compañera de charla", opener: "¡Hola! Quiero saber todo. ¿Cómo fue tu día hoy? ¿Bueno o difícil?", hint: "Hi! I want to know everything. How was your day today? Good or hard?" },
  { id: "finde", art: "park", voice: "male", voiceName: "Fenrir", title: "Planes del fin de semana", titleEn: "Weekend plans", goal: "Make real weekend plans together", goalEs: "Haz planes de verdad para el finde", who: "Diego, who always has plans", whoEs: "Diego, que siempre tiene planes", opener: "¡Oye! ¿Qué haces este fin de semana? ¿Tienes planes?", hint: "Hey! What are you doing this weekend? Do you have plans?" },
  { id: "restaurante", art: "cafe", voice: "male", voiceName: "Charon", title: "En el restaurante", titleEn: "At the restaurant", goal: "Order a meal and sort out a mix-up with your order", goalEs: "Pide la comida y arregla un error con tu pedido", who: "Andrés, a waiter at a busy restaurant in Bogotá", whoEs: "Andrés, camarero en un restaurante de Bogotá", opener: "¡Buenas tardes! Bienvenido. ¿Qué te traigo para tomar?", hint: "Good afternoon! Welcome. What can I bring you to drink?",
    twist: "Once the learner has ordered food, bring them something slightly different from what they asked for, so they have to sort it out politely. Apologise and fix it when they do." },
  { id: "estacion", art: "travel", voice: "female", voiceName: "Aoede", title: "En la estación", titleEn: "At the station", goal: "Buy a train ticket and ask how to get a taxi to your hotel", goalEs: "Compra un billete de tren y pregunta cómo coger un taxi al hotel", who: "Pilar, at the ticket window of Sevilla's train station", whoEs: "Pilar, trabaja en la taquilla de la estación de Sevilla", opener: "Hola, buenos días. ¿A dónde quieres viajar hoy?", hint: "Hello, good morning. Where do you want to travel today?" },
];

// Scene and contact copy in the learner's language, with the English kept for the EN peek.
const sceneGoal = (sc, t) => t(sc.goalEs || sc.goal_es || sc.goal, sc.goal);
const sceneWho = (sc, t) => t(sc.whoEs || sc.who_es || sc.who, sc.who);
const sceneTitleEn = sc => sc.titleEn || sc.title_en || sc.goal;

// Built-in characters each have their own Gemini voice. Custom ones get a stable pick from the
// voices of their gender, so two different people rarely sound the same.
const VOICE_POOLS = { female: ["Kore", "Aoede", "Leda"], male: ["Puck", "Charon", "Fenrir"] };
const voiceFor = (character) => {
  if (!character) return null;
  if (character.voiceName) return character.voiceName;
  const pool = VOICE_POOLS[character.voice === "male" ? "male" : "female"];
  const name = character.name || (character.who || "").split(",")[0];
  return pool[[...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % pool.length];
};

/* Global language switch: the floating ES · EN button flips every static UI string and
   revealed gloss to English, and stays that way (remembered per device) until switched back. */
const UIContext = createContext({ en: false, toggle: () => {} });
const useUI = () => useContext(UIContext);
const useT = () => {
  const { en } = useUI();
  return useCallback((es, enText) => (en ? enText : es), [en]);
};

/* Stroke icons, drawn in currentColor so they take the text color around them */
const ICONS = {
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></>,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
  speaker: <><path d="M11 5L6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></>,
  slow: <><path d="M11 5L6 9H3v6h3l5 4z" /><path d="M15 12h5" /></>,
  translate: <><path d="M4 6h9" /><path d="M8.5 4v2c0 4-2.5 7-5 8" /><path d="M6 10c1 2 3 3.5 5 4" /><path d="M13 20l4-9 4 9" /><path d="M14.5 17h5" /></>,
  bulb: <><path d="M9 18h6" /><path d="M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z" /></>,
  back: <path d="M15 6l-6 6 6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  send: <path d="M5 12h13M13 6l6 6-6 6" />,
  play: <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor" stroke="none" />,
  camera: <><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></>,
  retry: <><path d="M4 12a8 8 0 1 0 2.3-5.6" /><path d="M4 4v4h4" /></>,
  brain: <><path d="M9 4a3 3 0 0 0-3 3v.2A3 3 0 0 0 4 10a3 3 0 0 0 1 2.2A3 3 0 0 0 6 17a3 3 0 0 0 3 3V4z" /><path d="M15 4a3 3 0 0 1 3 3v.2a3 3 0 0 1 2 2.8 3 3 0 0 1-1 2.2 3 3 0 0 1-1 4.8 3 3 0 0 1-3 3V4z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.5v.1" /></>,
  sparkle: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" />,
  talk: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z" />,
  messages: <><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9.5h8M8 12.5h5" /></>,
  cards: <><rect x="3" y="7" width="14" height="13" rx="2" /><path d="M7 4h12a2 2 0 0 1 2 2v11" /></>,
  progress: <><path d="M12 21V11" /><path d="M12 11c0-4 3-6 7-6 0 4-3 6-7 6z" /><path d="M12 14c0-3-2.5-5-6-5 0 3 2.5 5 6 5z" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  share: <><path d="M12 15V3" /><path d="M7 8l5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></>,
  shield: <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>,
  circle: <circle cx="12" cy="12" r="7" />,
};
function Icon({ name, size = 20, stroke = 1.9 }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/* Characters get a colored initial, like a contact photo, instead of an emoji */
const AVATAR_COLORS = ["#E0533D", "#2E7D4F", "#3D5BA9", "#B8285A", "#8A5A12", "#5B4B9A"];
function Avatar({ name, size = 44 }) {
  const label = (name || "?").replace(/^(Doña|Don)\s+/, "").trim();
  const hue = [...label].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AVATAR_COLORS.length;
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42, background: AVATAR_COLORS[hue] }} aria-hidden="true">
      {label.charAt(0).toUpperCase()}
    </span>
  );
}

// Model-written English (hints, reasons, summaries) gets the same house style as the rest of
// the app: dashes become commas, so nothing reads like it came out of a template.
const plain = s => (typeof s === "string" ? s.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",").trim() : s);

/* ---------- "How it works": each screen's guide, in English since it's for when you're lost.
   Open on the first visit; once collapsed it stays a slim bar that opens again with a tap. ---------- */
function useTip(id) {
  const [open, setOpen] = useState(() => {
    try { return !JSON.parse(localStorage.getItem("charla:tips") || "[]").includes(id); } catch { return false; }
  });
  const toggle = useCallback(() => {
    setOpen(o => {
      try {
        const collapsed = JSON.parse(localStorage.getItem("charla:tips") || "[]").filter(x => x !== id);
        localStorage.setItem("charla:tips", JSON.stringify(o ? [...collapsed, id] : collapsed));
      } catch {}
      return !o;
    });
  }, [id]);
  return { open, toggle };
}

function Tip({ tip, title = "How it works", points }) {
  return (
    <aside className={"tipCard" + (tip.open ? " open" : "")} lang="en">
      <button className="tipHead" onClick={tip.toggle} aria-expanded={tip.open}>
        <Icon name="info" size={18} />
        <span className="tipTitle">{title}</span>
        <span className={"chev" + (tip.open ? " open" : "")} aria-hidden="true"><Icon name="back" size={18} /></span>
      </button>
      {tip.open && <ul className="tipList">{points.map((p, i) => <li key={i}>{p}</li>)}</ul>}
    </aside>
  );
}

function ScreenTitle({ es, en, children }) {
  return (
    <div className="screenTitle">
      <h1 className="display">{children || <TapPhrase es={es} en={en} />}</h1>
    </div>
  );
}

function loadSync(key, fallback) {
  try { const raw = localStorage.getItem("charla:" + key); return raw != null ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}

/* Starter glossary so the openers are tappable from the first second */
const BASE_GLOSS = {
  buenos: "good", dias: "day / morning", hola: "hi", oye: "hey", perdona: "excuse me",
  tengo: "I have", tienes: "you have", mangos: "mangoes", muy: "very", dulces: "sweet",
  hoy: "today", que: "what / that", buscas: "you're looking for", bueno: "good",
  verte: "to see you", cuentame: "tell me", haces: "you do", en: "in", tu: "your",
  vida: "life", trabajas: "you work", o: "or", estudias: "you study", estas: "you are",
  perdido: "lost", a: "to", donde: "where", quieres: "you want", ir: "to go",
  quiero: "I want", saber: "to know", todo: "everything", como: "how", fue: "was",
  dia: "day", difficil: "difficult", dificil: "difficult", este: "this", fin: "end",
  de: "of", semana: "week", planes: "plans", y: "and", el: "the", la: "the",
  los: "the", las: "the", un: "a", una: "a", es: "is", no: "no / not", si: "yes / if",
  gracias: "thank you", por: "for", favor: "please", me: "me / myself", te: "you",
  mi: "my", con: "with", para: "for", pero: "but", tambien: "also", mas: "more",
  habla: "speak", teclea: "type", primero: "first", despues: "after", cafe: "coffee",
  amigo: "friend", nuevo: "new", mercado: "market", verdad: "truth / real",
  buenas: "good", tardes: "afternoon", bienvenido: "welcome", traigo: "I bring", tomar: "to drink / to take",
  viajar: "to travel",
  baraja: "deck (of cards)", esta: "is / this", vacia: "empty", repaso: "review",
  hablado: "spoken", empezar: "to start", practicar: "to practice", todas: "all",
  reflexion: "reflection", sabia: "I knew it", otra: "another", vez: "time",
  pista: "hint", revelar: "to reveal", ocultar: "to hide", terminar: "to finish",
  guardar: "to save", nota: "note", del: "of the", cargando: "loading",
  escribe: "write", escucho: "I'm listening", toca: "tap", pensando: "thinking",
};

/* Tap any Spanish word to toggle its English gloss; unknown words get looked up once */
function TapText({ text, gloss, lookup, showAll }) {
  const [open, setOpen] = useState({});
  const { en: globalEn } = useUI();
  const all = showAll || globalEn;
  const parts = String(text).split(/(\s+)/);
  return (
    <span>
      {parts.map((tok, i) => {
        if (!/[a-záéíóúñü]/i.test(tok)) return <span key={i}>{tok}</span>;
        const key = strip(tok);
        const g = gloss[key];
        return (
          <span key={i} className="w" onClick={(e) => {
            e.stopPropagation();
            const opening = !open[i];
            setOpen(o => ({ ...o, [i]: opening }));
            if (opening && !g && lookup) lookup(key, text);
          }}>
            {tok}
            {(all || open[i]) && <span className="wG">{g || "…"}</span>}
          </span>
        );
      })}
    </span>
  );
}

/* ---------- Voice input (browser speech recognition) — speech output lives in voice.js ---------- */
const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

/* Push-to-talk hook: tap to start, tap to stop (or auto-stop on silence) */
function useMic(onFinal, lang = "es-MX") {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState(null);
  const recRef = useRef(null);
  const finalRef = useRef("");
  const cancelledRef = useRef(false);
  const t = useT();

  const stop = useCallback(() => { try { recRef.current?.stop(); } catch {} }, []);
  // Stop without sending — the lifeline opening mid-sentence shouldn't post the half-sentence.
  const cancel = useCallback(() => { cancelledRef.current = true; try { recRef.current?.abort(); } catch {} }, []);

  const start = useCallback(() => {
    if (!SR) return;
    hush(); // don't record while the app is talking
    setError(null);
    finalRef.current = "";
    cancelledRef.current = false;
    setInterim("");
    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let fin = "", inter = "";
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else inter += e.results[i][0].transcript;
      }
      if (fin) finalRef.current = fin;
      setInterim(inter || fin);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
      const text = finalRef.current.trim();
      if (text && !cancelledRef.current) onFinal(text);
    };
    rec.onerror = (e) => {
      setListening(false);
      setInterim("");
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(e.error === "not-allowed" || e.error === "service-not-allowed"
        ? t("Charla no tiene permiso para usar el micrófono. Puedes darlo en los ajustes del navegador.", "Charla isn't allowed to use the mic. You can allow it in your browser settings.")
        : t("El micrófono falló. Inténtalo otra vez.", "The mic didn't work. Try again."));
    };
    recRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { setListening(false); setError(t("No pude encender el micrófono.", "Couldn't start the mic.")); }
  }, [onFinal, t, lang]);

  return { supported: !!SR, listening, interim, start, stop, cancel, error };
}

/* Whole-phrase translation for branding & UI text — one tap shows the full sentence in English */
function TapPhrase({ es, en }) {
  const [open, setOpen] = useState(false);
  const { en: globalEn } = useUI();
  return (
    <span className="phrase" onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}>
      {es}
      {(open || globalEn) && <span className="wG">{en}</span>}
    </span>
  );
}

// Everything the model writes is shown to the learner, so it follows the app's own voice.
const STYLE_BASE = "Style for every text field: plain, warm and short. Never use em dashes or en dashes; use commas or full stops.";
const HOUSE_STYLE = STYLE_BASE + " No emoji.";
const TEXTING_STYLE = STYLE_BASE + " Like a real text from a friend, an emoji now and then is fine (at most one per message).";

function SpeakBtn({ text, rate, own, label }) {
  const t = useT();
  return (
    <button className="spkBtn" onClick={(e) => { e.stopPropagation(); speak(text, rate, { own }); }} aria-label={label || t("Escuchar", "Play")}>
      <Icon name="speaker" size={16} />
    </button>
  );
}

/* One chat line, shared by Hablar and Mensajes: tappable words, replay, translation, the one
   live correction, and new-word chips that save to the deck. */
function ChatMessage({ m, mine, isLast, busy, onRetry, words, saveWord, gloss, lookupWord }) {
  const t = useT();
  const { en: globalEn } = useUI();
  // View toggles are per screen visit, not saved: tapping "Translate" shouldn't write to the server.
  const [showAll, setShowAll] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const side = mine ? "me" : "ai";
  // The reply's own glossary wins: "como" means "how" in one line and "I eat" in another.
  const g = m.gloss ? { ...gloss, ...m.gloss } : gloss;
  return (
    <div className={"row " + side}>
      <div className={"bubble " + side + (m.error ? " err" : "")}>
        <div>{!mine && !m.error ? <TapText text={m.es} gloss={g} lookup={lookupWord} showAll={showAll} /> : m.es}</div>
        {!mine && !m.error && (
          <div className="bubbleTools">
            <button className="tool" onClick={() => speak(m.es)} aria-label={t("Escuchar", "Play")}><Icon name="speaker" size={16} /></button>
            <button className="tool" onClick={() => speak(m.es, 0.65)} aria-label={t("Escuchar más lento", "Play slower")}><Icon name="slow" size={16} /></button>
            <button className="tool" onClick={() => setShowAll(v => !v)} aria-pressed={showAll}>
              <Icon name="bulb" size={15} /> {showAll ? t("Ocultar", "Hide") : t("Palabras", "Words")}
            </button>
            {m.hint && (
              <button className="tool" onClick={() => setShowHint(v => !v)} aria-pressed={showHint}>
                <Icon name="translate" size={15} /> {showHint ? t("Ocultar", "Hide") : t("Traducir", "Translate")}
              </button>
            )}
          </div>
        )}
        {m.error && isLast && (
          <button className="tool" onClick={onRetry} disabled={busy}><Icon name="retry" size={15} /> {t("Reintentar", "Retry")}</button>
        )}
        {(showHint || globalEn) && m.hint && <div className="hintText">{plain(m.hint)}</div>}
      </div>
      {m.correction && (
        <div className="correction">
          <span className="corrLabel">{t("Mejor así", "Better like this")}</span>
          <div>
            <s><TapText text={m.correction.you_said} gloss={gloss} lookup={lookupWord} /></s>{" → "}
            <b><TapText text={m.correction.better} gloss={gloss} lookup={lookupWord} /></b> <SpeakBtn text={m.correction.better} />
          </div>
          {m.correction.why && <div className="corrWhy">{plain(m.correction.why)}</div>}
        </div>
      )}
      {m.new_words?.length > 0 && (
        <div className="chips">
          {m.new_words.map((w, k) => {
            const saved = words.some(x => strip(x.es) === strip(w.es));
            return (
              <button key={k} className={"chip " + (saved ? "saved" : "")} onClick={() => { speak(w.es); saveWord(w); }}
                      aria-label={saved ? t(`${w.es}, ya está en tu baraja`, `${w.es}, already in your deck`) : t(`Guardar ${w.es}`, `Save ${w.es}`)}>
                <b>{w.es}</b> · {w.en} <Icon name={saved ? "check" : "plus"} size={14} stroke={2.4} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function buildSystemPrompt(sc) {
  return `You are ${sc.who}, having a SPOKEN conversation with a BEGINNER Spanish learner (A1–A2). Scenario: "${sc.title}". Learner's goal: ${sc.goal}.${sc.twist ? `\n${sc.twist}` : ""}
The learner is SPEAKING and their words arrive via imperfect speech recognition — be forgiving of odd transcriptions and guess the intended meaning.
Rules:
- Reply in simple spoken Spanish, max 2 short sentences, warm and natural. No emojis, no formatting (it will be read aloud).
- Have a MEANINGFUL conversation: ask about the learner's real life, opinions, feelings. Never stall on greetings.
- Always end with one question.
- If the learner clearly made a language error (not a transcription glitch), give a recast in "correction". Otherwise null.
- Introduce at most 2 genuinely useful new words/phrases per turn in "new_words" (may be empty).
${HOUSE_STYLE}
Respond ONLY with JSON, no markdown fences:
{"reply":"Spanish reply","hint":"English translation of reply","gloss":{"each word of your reply, lowercase, no punctuation":"short English meaning as used here"},"correction":{"you_said":"","better":"","why":""} OR null,"new_words":[{"es":"","en":"","example":"short Spanish example"}]}
The "gloss" must cover every word in "reply" (and in any example sentences), so a pure beginner can tap any word to see its meaning.`;
}

// Live (real-time voice) version: the model speaks its reply, so no JSON — the hint, glossary and
// correction come from a separate annotationPrompt() call in the background. It's rebuilt on every (re)connect, so it
// carries the conversation so far.
function buildLivePrompt(sc, msgs) {
  const transcript = msgs.filter(m => !m.error && m.es).map(m => (m.role === "me" ? "Learner: " : "You: ") + m.es).join("\n");
  return `You are ${sc.who}, having a SPOKEN conversation with a BEGINNER Spanish learner (A1–A2). Scenario: "${sc.title}". Learner's goal: ${sc.goal}.${sc.twist ? `\n${sc.twist}` : ""}
Rules:
- Speak only simple, natural Spanish: max 2 short sentences per turn, then stop and let them talk. Speak warmly, clearly, and a little slower than normal.
- Be forgiving of accent, pronunciation and grammar — guess what they mean.
- Have a MEANINGFUL conversation: ask about the learner's real life, opinions, feelings. Never stall on greetings.
- Always end your turn with one question.
- Don't correct the learner out loud — corrections are shown to them on screen separately.
- If they're stuck or slip into English, give them the Spanish words they need in one short sentence, then carry on.
The conversation so far (you already said the first line — don't greet again; wait for the learner, then continue naturally):
${transcript}`;
}

function annotationPrompt(sc, learner, partner) {
  return `A BEGINNER Spanish learner (A1–A2) is having a spoken practice conversation with ${sc.who}. Scenario: "${sc.title}".
The learner said (transcribed from speech — expect transcription glitches): "${learner}"
The partner replied: "${partner}"
${HOUSE_STYLE}
Respond ONLY with JSON, no markdown fences:
{"hint":"English translation of the partner's reply","gloss":{"each word of the partner's reply, lowercase, no punctuation":"short English meaning as used here"},"correction":{"you_said":"","better":"","why":""} OR null,"new_words":[{"es":"","en":"","example":"short Spanish example"}]}
- "correction": only if the learner clearly made a language error (not a transcription glitch) — recast it. Otherwise null.
- "new_words": at most 2 genuinely useful words/phrases from the partner's reply (may be empty).
- "gloss" must cover every word in the partner's reply (and in any example sentences), so a pure beginner can tap any word to see its meaning.`;
}

/* ---------- Lifeline (¿Cómo se dice?): say it in English, get the Spanish back, then try it yourself ---------- */
function lifelinePrompt(sc, partner, english) {
  return `A BEGINNER Spanish learner (A1–A2) is in a spoken practice conversation with ${sc.who}. Scenario: "${sc.title}".
${partner ? `The partner just said: "${partner}"\n` : ""}The learner is stuck and said in English what they want to say (it may be transcribed from speech): "${english}"
Give them the Spanish to say it: simple, natural spoken Spanish at their level that fits the conversation.
${HOUSE_STYLE}
Respond ONLY with JSON, no markdown fences:
{"es":"the Spanish line","chunks":[{"es":"","en":""}],"note":"one short tip in English about the most useful part, or empty","gloss":{"each word of the line, lowercase, no punctuation":"short English meaning as used here"}}
- "chunks": 2-4 meaningful chunks, in order, that together make up the whole line, each with its English meaning.`;
}

/* ---------- Can-do map: CEFR A1–A2 descriptors grouped by life area. Chats are the evidence. ---------- */
const CAN_DO = [
  { id: "food", es: "Cafés y comida", en: "Cafés and food", items: [
    { id: "order", scene: "restaurante", es: "Pedir algo de comer o beber", en: "Order food or a drink" },
    { id: "price", scene: "mercado", es: "Preguntar cuánto cuesta algo", en: "Ask what something costs" },
    { id: "food_likes", scene: "restaurante", es: "Decir qué te gusta comer", en: "Say what food you like" },
    { id: "wrong_order", scene: "restaurante", es: "Resolver un pedido equivocado", en: "Sort out a wrong order" },
  ] },
  { id: "around", es: "Moverte por la ciudad", en: "Getting around", items: [
    { id: "ask_way", scene: "perdido", es: "Preguntar cómo llegar a un lugar", en: "Ask how to get somewhere" },
    { id: "follow_way", scene: "perdido", es: "Entender indicaciones sencillas", en: "Follow simple directions" },
    { id: "transport", scene: "estacion", es: "Comprar un billete o pedir un taxi", en: "Buy a ticket or get a taxi" },
    { id: "lost", scene: "perdido", es: "Pedir ayuda cuando estás perdido", en: "Ask for help when you're lost" },
  ] },
  { id: "people", es: "Conocer gente", en: "Meeting people", items: [
    { id: "introduce", scene: "cafe", es: "Presentarte", en: "Introduce yourself" },
    { id: "ask_about", scene: "cafe", es: "Preguntar a alguien por su vida", en: "Ask someone about themselves" },
    { id: "plans", scene: "finde", es: "Hacer planes para quedar", en: "Make plans to meet up" },
    { id: "opinion", scene: "finde", es: "Decir lo que piensas de algo", en: "Say what you think about something" },
  ] },
  { id: "me", es: "Yo y mi vida", en: "Me and my life", items: [
    { id: "work", scene: "cafe", es: "Hablar de tu trabajo o tus estudios", en: "Talk about your work or studies" },
    { id: "family", scene: "dia", es: "Hablar de tu familia", en: "Talk about your family" },
    { id: "day", scene: "dia", es: "Contar cómo fue tu día", en: "Tell how your day went" },
    { id: "feelings", scene: "dia", es: "Decir cómo te sientes", en: "Say how you feel" },
  ] },
];
const CAN_DO_ITEMS = CAN_DO.flatMap(area => area.items.map(item => ({ ...item, area })));

// sessions: finished chats (minutes). days: other practice per calendar day (reviews, texts).
const EMPTY_PROGRESS = { sessions: [], cando: {}, errors: {}, days: {} };
const ERROR_TAGS = ["grammar", "word_choice", "gender", "conjugation", "other"];

/* ---------- Rewind: one call at the end of a chat — fixes, can-do evidence and the reflection ---------- */
// Lines the rewind can point back to by number — the same filter as the transcript it's shown.
const rewindLines = (msgs) => msgs.filter(m => !m.error && m.es);

function rewindPrompt(sc, msgs) {
  const lines = rewindLines(msgs);
  const transcript = lines.map((m, i) => `[${i + 1}] ${m.role === "me" ? "Learner" : "Partner"}: ${m.es}`).join("\n");
  const shown = lines.filter(m => m.correction?.better).map(m => `- "${m.correction.you_said}" → "${m.correction.better}"`).join("\n");
  const canDo = CAN_DO_ITEMS.map(i => `${i.id}: ${i.en}`).join("\n");
  return `A BEGINNER Spanish learner (A1–A2) just finished this spoken practice conversation with ${sc.who}. Scenario: "${sc.title}".
The learner's lines came through speech recognition: ignore transcription glitches (odd spellings, missing accents or punctuation) and only flag real language errors.
${transcript}
${shown ? `\nCorrections already shown during the chat:\n${shown}\n` : ""}
Can-do statements (id: description):
${canDo}

${HOUSE_STYLE}
Respond ONLY with JSON, no markdown fences:
{"summary":"1 warm sentence in English about what they did","summary_es":"the same sentence in very simple Spanish","can_now_say":["2-3 Spanish phrases they used or learned"],"questions":["2 short reflection questions in English about what was hard or what they'd say differently"],"questions_es":["the same 2 questions in very simple Spanish"],"fixes":[{"line":1,"you_said":"","better":"","en":"","why":"","tag":"grammar|word_choice|gender|conjugation|other"}],"can_do":[{"id":"","level":"done|partial","quote":""}]}
- "fixes": at most 5 of the learner's own lines, most useful first; [] if there were no real errors. "line" is the [number] above, "you_said" the learner's sentence, "better" the more natural version changing as little as possible, "en" its English meaning, "why" one short reason in English.
- "can_do": only statements the LEARNER actually did in their own lines. "done" = managed it on their own; "partial" = tried but needed a lot of help or it didn't come across. "quote" = the learner's line that shows it. [] if none.`;
}

// Word-level diff (LCS) so the rewind can strike what changed and highlight what replaced it.
// Compares stripped words, so a missing accent from speech recognition doesn't count as a change.
function diffWords(said, better) {
  const A = said.split(/\s+/).filter(Boolean), B = better.split(/\s+/).filter(Boolean);
  const L = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      L[i][j] = strip(A[i]) === strip(B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const keptA = new Set(), keptB = new Set();
  for (let i = 0, j = 0; i < A.length && j < B.length;) {
    if (strip(A[i]) === strip(B[j])) { keptA.add(i); keptB.add(j); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return {
    said: A.map((w, i) => ({ w, changed: !keptA.has(i) })),
    better: B.map((w, j) => ({ w, changed: !keptB.has(j) })),
  };
}

// speak() reads the voice when it's called, so a one-off line (a review card's original moment)
// can borrow its character's voice without a chat being open.
function speakAs(voice, text, rate) {
  setCharacterVoice(voice);
  speak(text, rate);
  setCharacterVoice(null);
}

const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1);
const partnerName = sc => (sc?.who || "").split(",")[0].trim();

/* ---------- Mensajes: contacts who text you first, like real friends ---------- */
const CONTACTS = [
  { id: "mateo", voice: "male", voiceName: "Puck", name: "Mateo", about: "tu amigo de Buenos Aires", aboutEn: "your friend from Buenos Aires", topics: "plans to hang out, something that happened to him, checking in on your life" },
  { id: "rosa", voice: "female", voiceName: "Aoede", name: "Doña Rosa", about: "la vendedora del mercado", aboutEn: "the market vendor", topics: "new fruit that just came in, a discount, asking how you're doing" },
  { id: "lucia", voice: "female", voiceName: "Leda", name: "Lucía", about: "la madrileña que conociste en la calle", aboutEn: "the madrileña you met in the street", topics: "meeting up for coffee, asking if you got somewhere okay" },
  { id: "camila", voice: "female", voiceName: "Kore", name: "Camila", about: "tu amiga que siempre pregunta por tu día", aboutEn: "your friend who always asks about your day", topics: "asking how your day went, sharing something from her day, sending encouragement" },
  { id: "diego", voice: "male", voiceName: "Fenrir", name: "Diego", about: "tu amigo que siempre tiene planes", aboutEn: "your friend who always has plans", topics: "inviting you to something this weekend, telling you about a plan" },
];

function buildContactSystemPrompt(c) {
  return `You are ${c.name} (${c.about}), texting your friend — a BEGINNER Spanish learner (A1–A2) — over something like WhatsApp. You text about things like: ${c.topics}.
Rules:
- Write like a real informal text message: short (1-2 sentences), warm, simple Spanish.
- The learner's replies may be typed or dictated (imperfect speech recognition) — be forgiving of odd phrasing and guess the intended meaning.
- Keep the thread going naturally; don't just greet on loop.
- If the learner makes a clear language error (not just casual texting style), you may gently recast it in "correction" — keep it light, this is texting, not a lesson. Otherwise null.
- Introduce at most 1 useful new word/phrase per message in "new_words" (may be empty).
${TEXTING_STYLE}
Respond ONLY with JSON, no markdown fences:
{"reply":"your text message in Spanish","hint":"English translation","gloss":{"each word of your reply, lowercase, no punctuation":"short English meaning as used here"},"correction":{"you_said":"","better":"","why":""} OR null,"new_words":[{"es":"","en":"","example":"short Spanish example"}]}
The "gloss" must cover every word in "reply" so a pure beginner can tap any word to see its meaning.`;
}

const OPENER_META = "\n\n(Meta: this is the FIRST message of a brand-new conversation — you're texting out of the blue about one of your usual topics. Don't send a generic greeting-and-wait; get into something real in 1-2 short sentences, like a real opening text.)";
// Sent as a hidden turn when it's time for a contact to text again in an existing thread.
const FOLLOWUP_META = "(Meta, not from the learner: a day or more has passed since your last messages. Text them again out of the blue, like a real friend would: follow up on something from before, or bring up one of your usual topics. Reply in the same JSON format and never mention this note.)";

const initialDue = () => Date.now() + (6 * 3600000 + Math.random() * 18 * 3600000); // first text within 6-24h
const nextInterval = () => Date.now() + (24 * 3600000 + Math.random() * 3 * dayMs); // 1-4 days later

// Every failure carries a kind, so the learner is told *why* instead of always "check your connection".
class AIError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

function errorText(err, t) {
  switch (err?.kind) {
    case "network": return t("No llego al servidor. Revisa tu conexión e inténtalo otra vez.", "Couldn't reach the server. Check your connection and try again.");
    case "session": return t("Tu sesión caducó. Vuelve a entrar.", "Your session expired. Sign in again.");
    case "rate": return t("Vas un poco rápido. Espera un momento e inténtalo otra vez.", "You're going a bit fast. Wait a moment and try again.");
    case "auth": case "quota": case "model": return t("Tu proveedor de IA dio un problema. Mira el aviso de arriba.", "Your AI provider had a problem. See the notice at the top.");
    case "parse": return t("La respuesta llegó rara. Inténtalo otra vez.", "The reply came back garbled. Try again.");
    default: return t("La IA no respondió. Inténtalo otra vez.", "The AI didn't answer. Try again.");
  }
}

// json: ask the provider for JSON output (callers that parse the reply as JSON).
async function askAI(messages, { json = false } = {}) {
  let res;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, json }),
      // The server gives up on the provider well before this; this only catches a dead connection.
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new AIError("Couldn't reach the server", "network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent("charla:session-expired"));
      throw new AIError("Not signed in", "session");
    }
    // A rejected key, empty balance, or mistyped model would otherwise surface as a vague error at
    // every call site — broadcast it once so the app shell can point to AI settings instead.
    if (data.kind === "auth" || data.kind === "quota" || data.kind === "model") {
      window.dispatchEvent(new CustomEvent("charla:ai-problem", { detail: { kind: data.kind, message: data.error } }));
    }
    throw new AIError(data.error || `Request failed (${res.status})`, data.kind || "upstream");
  }
  return (data.text || "").replace(/```json|```/g, "").trim();
}

// Models sometimes wrap JSON in prose. Never fall back to treating the raw text as the reply — that
// put literal JSON in the chat bubble and had it read aloud. Returns null when there's no JSON.
function parseAIJson(raw) {
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) try { return JSON.parse(match[0]); } catch {}
  return null;
}
function parseReply(raw) {
  const p = parseAIJson(raw);
  if (typeof p?.reply !== "string" || !p.reply.trim()) throw new AIError("Unreadable reply", "parse");
  return p;
}

async function fetchAISettings() {
  try {
    const res = await fetch("/api/ai/settings");
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

// Device-local only, scoped to the signed-in user — for state that shouldn't follow the account
// across devices (the in-progress Hablar chat, an unsaved rewind).
function saveLocal(key, val) {
  try {
    if (val == null) localStorage.removeItem("charla:" + key);
    else localStorage.setItem("charla:" + key, JSON.stringify(val));
  } catch (e) { console.error("save failed", e); }
}

// Data saved on this device before accounts existed. It goes to the first account that signs in
// here, only if that account has nothing for the key yet, and is then removed from the device, so
// another account signing in on the same device never inherits it.
const LEGACY_KEYS = ["palabras", "reflexiones", "escenas", "glosario", "hilos"];
async function migrateLocalDataToServer() {
  for (const key of LEGACY_KEYS) {
    let local = null;
    try { local = JSON.parse(localStorage.getItem("charla:" + key)); } catch {}
    if (local == null) continue;
    try {
      const res = await fetch(`/api/data/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: local, baseVersion: 0 }),
      });
      if (res.ok || res.status === 409) localStorage.removeItem("charla:" + key); // 409: the account has its own already
    } catch {}
  }
  // Unscoped leftovers from before device state was per-user; they'd show one account's chat to the next.
  ["migrated", "sesionActiva"].forEach(k => { try { localStorage.removeItem("charla:" + k); } catch {} });
}

const STORE_DEFAULTS = { palabras: [], reflexiones: [], escenas: [], glosario: {}, hilos: {}, progreso: EMPTY_PROGRESS };
const GLOSS_CAP = 4000;
const emptyThread = () => ({ msgs: [], apiHistory: [], unread: false, nextDue: initialDue() });

function useStore(store) {
  const [, rerender] = useReducer(n => n + 1, 0);
  useEffect(() => store.subscribe(rerender), [store]);
  return store.value;
}

// Keeps the last ~400 days of per-day activity counts.
function pruneDays(days) {
  const keys = Object.keys(days);
  if (keys.length <= 400) return days;
  const keep = keys.sort((a, b) => new Date(b) - new Date(a)).slice(0, 400);
  return Object.fromEntries(keep.map(k => [k, days[k]]));
}

function AppInner({ user, logout }) {
  const [tab, setTab] = useState("hablar");
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [pendingOpenId, setPendingOpenId] = useState(null);
  const [pendingScene, setPendingScene] = useState(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [aiSettings, setAISettings] = useState(null);
  const [showAISettings, setShowAISettings] = useState(false);
  const [aiProblem, setAIProblem] = useState(null);
  const [reviewQueue, setReviewQueue] = useState(null);
  const [loadState, setLoadState] = useState("loading"); // "loading" | "ready" | "error"
  const [saveStatus, setSaveStatus] = useState({}); // store key → "ok" | "error" | "auth"
  const [sessionExpired, setSessionExpired] = useState(false);
  const [, tick] = useReducer(n => n + 1, 0);
  const profileRef = useRef(null);
  const generating = useRef(new Set()); // contacts whose next text is being written (never saved)
  const t = useT();

  const storesRef = useRef(null);
  storesRef.current ??= Object.fromEntries(Object.entries(STORE_DEFAULTS).map(([key, fallback]) => [key,
    new SyncedKey(key, fallback, { scope: user.id, onStatus: (k, status) => setSaveStatus(s => ({ ...s, [k]: status })) })]));
  const stores = storesRef.current;
  const words = useStore(stores.palabras);
  const reflections = useStore(stores.reflexiones);
  const customScenes = useStore(stores.escenas);
  const savedGloss = useStore(stores.glosario);
  const threads = useStore(stores.hilos);
  const progress = { ...EMPTY_PROGRESS, ...useStore(stores.progreso) };
  const gloss = useMemo(() => ({ ...BASE_GLOSS, ...savedGloss }), [savedGloss]);

  // All-or-nothing: if any key can't be read, nothing renders, so nothing can save over it.
  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      await Promise.all(Object.values(stores).map(s => (s.loaded ? null : s.load())));
      stores.hilos.update(all => {
        let next = all;
        for (const c of CONTACTS) {
          const th = next[c.id];
          if (!th) next = { ...next, [c.id]: emptyThread() };
          else if ("generating" in th) { // older versions saved this flag, and a closed tab left it stuck on
            const { generating: _, ...rest } = th;
            next = { ...next, [c.id]: rest };
          }
        }
        return next;
      });
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [stores]);

  useEffect(() => { load(); return hush; }, [load]);

  // Another tab or device may have saved meanwhile; going to the background is a good moment to save.
  useEffect(() => {
    const onVisibility = () => Object.values(stores).forEach(s => (document.visibilityState === "visible" ? s.refresh() : s.flush()));
    document.addEventListener("visibilitychange", onVisibility);
    const id = setInterval(tick, 60000); // due counts and badges move with the clock
    return () => { document.removeEventListener("visibilitychange", onVisibility); clearInterval(id); };
  }, [stores]);

  useEffect(() => {
    fetchAISettings().then(setAISettings);
    const onProblem = (e) => setAIProblem(e.detail);
    const onExpired = () => setSessionExpired(true);
    window.addEventListener("charla:ai-problem", onProblem);
    window.addEventListener("charla:session-expired", onExpired);
    return () => {
      window.removeEventListener("charla:ai-problem", onProblem);
      window.removeEventListener("charla:session-expired", onExpired);
    };
  }, []);

  useEffect(() => {
    if (!showProfileMenu) return;
    const onDown = e => { if (!profileRef.current?.contains(e.target)) setShowProfileMenu(false); };
    const onKey = e => { if (e.key === "Escape") setShowProfileMenu(false); };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  }, [showProfileMenu]);

  const openAISettings = () => {
    setShowProfileMenu(false);
    setAIProblem(null);
    setShowAISettings(true);
    fetchAISettings().then(s => s && setAISettings(s));
  };
  const activeProvider = aiSettings?.providers.find(p => p.id === aiSettings.provider);
  useEffect(() => { setVoiceProvider(aiSettings?.provider); }, [aiSettings?.provider]);
  // Real-time voice is Gemini-only; until settings load, assume the default (Gemini) — the server
  // refuses a Live session for anyone else, and Hablar falls back to the classic pipeline.
  const liveVoice = aiSettings ? aiSettings.provider === "gemini" : true;

  // Every change is a function of the latest value, so slow AI calls and other tabs can't undo it.
  const updateWords = useCallback(fn => stores.palabras.update(fn), [stores]);
  const updateReflections = useCallback(fn => stores.reflexiones.update(fn), [stores]);
  const updateScenes = useCallback(fn => stores.escenas.update(fn), [stores]);
  const updateProgress = useCallback(fn => stores.progreso.update(p => fn({ ...EMPTY_PROGRESS, ...p })), [stores]);
  const updateThread = useCallback((id, fn) => stores.hilos.update(all => ({ ...all, [id]: fn(all[id] || emptyThread()) })), [stores]);
  const getThread = useCallback(id => stores.hilos.value[id] || emptyThread(), [stores]);

  const mergeGloss = useCallback((add) => {
    const clean = normGloss(add);
    if (!Object.keys(clean).length) return;
    stores.glosario.update(prev => {
      if (Object.entries(clean).every(([k, v]) => prev[k] === v)) return prev;
      const next = { ...prev, ...clean };
      // It's uploaded whole, so it stays bounded. Postgres JSONB doesn't keep key order, so this
      // drops arbitrary old entries rather than the oldest; each reply also keeps its own gloss.
      const keys = Object.keys(next);
      if (keys.length > GLOSS_CAP) keys.slice(0, keys.length - GLOSS_CAP).forEach(k => { if (!(k in clean)) delete next[k]; });
      return next;
    });
  }, [stores]);

  const recordActivity = useCallback((kind) => {
    const k = dayKey(Date.now());
    updateProgress(p => {
      const d = p.days[k] || {};
      return { ...p, days: pruneDays({ ...p.days, [k]: { ...d, [kind]: (d[kind] || 0) + 1 } }) };
    });
  }, [updateProgress]);

  // Contacts text first, then again every few days. One LLM call at a time, to stay gentle on the
  // free Gemini tier, and never on top of a text the learner hasn't answered yet.
  const checkDue = useCallback(async () => {
    if (!stores.hilos.loaded) return;
    for (const c of CONTACTS) {
      const th = stores.hilos.value[c.id];
      if (!th || generating.current.has(c.id) || th.nextDue > Date.now()) continue;
      const history = th.apiHistory || [];
      const awaiting = th.awaitingReply ?? (th.msgs.length > 0 && !th.msgs.some(m => m.role === "me"));
      if (awaiting || history[history.length - 1]?.role === "user") {
        updateThread(c.id, cur => ({ ...cur, nextDue: nextInterval() }));
        continue;
      }
      const opening = history.length === 0;
      generating.current.add(c.id);
      try {
        const raw = await askAI(opening
          ? [{ role: "user", content: buildContactSystemPrompt(c) + OPENER_META }]
          : [...history, { role: "user", content: FOLLOWUP_META }], { json: true });
        const p = parseReply(raw);
        mergeGloss(p.gloss);
        updateThread(c.id, cur => {
          // The learner texted while this was being written: their conversation wins, try later.
          if ((cur.apiHistory?.length || 0) !== history.length) return { ...cur, nextDue: nextInterval() };
          return {
            ...cur,
            msgs: [...cur.msgs, { role: "them", es: p.reply, hint: p.hint, correction: null, new_words: p.new_words || [], gloss: normGloss(p.gloss), ts: Date.now() }],
            apiHistory: opening
              ? [{ role: "user", content: buildContactSystemPrompt(c) }, { role: "assistant", content: raw }]
              : [...history, { role: "user", content: FOLLOWUP_META }, { role: "assistant", content: raw }],
            unread: true, awaitingReply: true, nextDue: nextInterval(),
          };
        });
      } catch {
        updateThread(c.id, cur => ({ ...cur, nextDue: Date.now() + 30 * 60000 })); // back off, don't retry every check
      } finally {
        generating.current.delete(c.id);
      }
    }
  }, [stores, updateThread, mergeGloss]);

  useEffect(() => {
    if (loadState !== "ready") return;
    checkDue();
    const id = setInterval(checkDue, 5 * 60000);
    const onVisible = () => document.visibilityState === "visible" && checkDue();
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [loadState, checkDue]);

  const unreadCount = Object.values(threads).filter(th => th.unread).length;

  const lookupWord = useCallback(async (word, context) => {
    try {
      const raw = await askAI([{ role: "user", content: `In the Spanish sentence "${context}", what does the word "${word}" mean in English? Reply with ONLY the short English equivalent (1-4 words), no punctuation, nothing else.` }]);
      const en = raw.split("\n")[0].replace(/["'.]/g, "").trim();
      if (en && en.length < 40) mergeGloss({ [word]: en });
    } catch {}
  }, [mergeGloss]);

  const dueCount = words.filter(w => w.due <= Date.now()).length;

  // Logs a finished chat: minutes, can-do evidence, error tags, all tagged with the chat's id (ref)
  // so deleting the chat can take them back out. Returns the statements it just completed.
  const recordChat = ({ minutes, canDo, scene, fixes, ref }) => {
    const now = Date.now();
    const merge = (p) => {
      const cando = { ...p.cando };
      const completed = [];
      for (const c of Array.isArray(canDo) ? canDo : []) {
        const item = CAN_DO_ITEMS.find(i => i.id === c?.id);
        if (!item) continue;
        const prev = cando[item.id];
        const wasDone = prev?.status === "done";
        const done = wasDone || c.level === "done";
        const quote = typeof c.quote === "string" ? c.quote.trim() : "";
        if (done && !wasDone) completed.push({ ...item, quote, scene });
        cando[item.id] = {
          status: done ? "done" : "partial", doneBy: wasDone ? prev.doneBy : done ? ref : null,
          evidence: [...(prev?.evidence || []), { quote, scene, ts: now, ref }].slice(-3),
        };
      }
      const errors = { ...p.errors };
      fixes.forEach(f => { errors[f.tag] = (errors[f.tag] || 0) + 1; });
      return {
        next: { ...p, sessions: [...p.sessions, { ts: now, minutes, scene, ref }].slice(-500), cando, errors },
        completed: completed.map(c => ({ ...c, areaDone: c.area.items.filter(i => cando[i.id]?.status === "done").length })),
      };
    };
    const { completed } = merge({ ...EMPTY_PROGRESS, ...stores.progreso.value });
    updateProgress(p => merge(p).next);
    return completed;
  };

  const deleteChat = (r) => {
    updateReflections(rs => rs.filter(x => x.id !== r.id));
    updateProgress(p => removeChatFromProgress(p, r.id, r.fixes || []));
  };

  // The rewind lives here, not in Hablar, and on the device: switching tabs or reloading mid-rewind
  // used to throw away the cards the learner was about to keep.
  const rewindKey = `rewind:${user.id}`;
  const [rewind, setRewindState] = useState(() => loadSync(rewindKey, null));
  const setRewind = useCallback((v) => setRewindState(prev => {
    const next = typeof v === "function" ? v(prev) : v;
    saveLocal(rewindKey, next);
    return next;
  }), [rewindKey]);

  const goReview = (esList) => { setReviewQueue(esList); setTab("repasar"); };
  const goPractice = (sceneId) => { setPendingScene(sceneId); setTab("hablar"); };

  const signOut = async () => {
    setShowProfileMenu(false);
    hush();
    // Give unsaved changes a moment to reach the server; any that can't stay in this user's rescue copy.
    await Promise.race([Promise.all(Object.values(stores).map(s => s.flush())), new Promise(r => setTimeout(r, 3000))]);
    saveLocal(`sesionActiva:${user.id}`, null);
    saveLocal(rewindKey, null);
    logout();
  };

  const saveProblem = sessionExpired || Object.values(saveStatus).includes("auth") ? "auth"
    : Object.values(saveStatus).includes("error") ? "error" : null;

  return (
    <div className="app">
      <style>{css}</style>
      <header className="top">
        <div className="brand">Charla<BubbleDot /></div>
        <div className="tag"><TapPhrase es="habla primero, teclea después" en="speak first, type later" /></div>
        <LangSwitch />
        <div className="profileWrap" ref={profileRef}>
          <button className="profileChip" onClick={() => setShowProfileMenu(s => !s)} title={user.name || user.email}
                  aria-haspopup="menu" aria-expanded={showProfileMenu} aria-label={t("Tu cuenta", "Your account")}>
            {user.picture && !avatarFailed ? <img src={user.picture} alt="" className="profileAvatar" referrerPolicy="no-referrer" onError={() => setAvatarFailed(true)} /> : <span className="profileAvatar profileAvatarFallback">{(user.name || user.email || "?")[0].toUpperCase()}</span>}
          </button>
          {showProfileMenu && (
            <div className="profileMenu">
              <div className="profileName">{user.name || t("Sin nombre", "No name")}</div>
              <div className="profileEmail dim">{user.email}</div>
              <button className="profileItem" onClick={openAISettings}>
                <span>{t("Modelo de IA", "AI model")}</span>
                <span className="dim">{activeProvider ? (aiSettings.usingFreeTier ? t("Gemini gratis", "Free Gemini") : activeProvider.label) : "…"}</span>
              </button>
              <button className="profileItem" onClick={() => { setShowProfileMenu(false); setShowPrivacy(true); }}>
                <span>{t("Privacidad", "Privacy")}</span>
                <span className="dim">{t("Tus datos", "Your data")}</span>
              </button>
              <button className="profileLogout" onClick={signOut}>{t("Cerrar sesión", "Sign out")}</button>
            </div>
          )}
        </div>
      </header>
      {saveProblem && (
        <div className="noticeBar problem" role="status">
          <span>
            {saveProblem === "auth"
              ? <>{t("Tu sesión caducó. Lo que no se guardó sigue en este dispositivo y se subirá cuando vuelvas a entrar.", "Your session expired. Anything unsaved is kept on this device and uploads when you sign in again.")}{" "}
                  <a className="linkBtn" href="/api/auth/google">{t("Entrar otra vez", "Sign in again")}</a></>
              : t("No puedo guardar ahora mismo. Lo sigo intentando.", "Can't save right now. Still trying.")}
          </span>
        </div>
      )}
      {aiProblem && (
        <div className="noticeBar problem">
          <span>
            {(() => {
              const who = activeProvider?.label || t("Tu proveedor de IA", "Your AI provider");
              return aiProblem.kind === "auth" ? t(`${who} rechazó tu clave.`, `${who} rejected your API key.`)
                : aiProblem.kind === "model" ? t(`${who} no reconoce el modelo que elegiste.`, `${who} doesn't recognize the model you picked.`)
                : t(`${who} dice que no te queda saldo o que vas demasiado rápido.`, `${who} says you're out of credit or rate-limited.`);
            })()}
            {" "}<button className="linkBtn" onClick={openAISettings}>{t("Ajustes de IA", "AI settings")}</button>
          </span>
          <button className="iconBtn small" onClick={() => setAIProblem(null)} aria-label={t("Cerrar", "Close")}><Icon name="close" size={16} /></button>
        </div>
      )}
      {showPrivacy && <PrivacySheet freeTier={!!aiSettings?.usingFreeTier} onClose={() => setShowPrivacy(false)} onAISettings={() => { setShowPrivacy(false); openAISettings(); }} />}
      {showAISettings && aiSettings && <AISettings settings={aiSettings} setSettings={setAISettings} onClose={() => setShowAISettings(false)} />}
      <main className="main">
        {loadState === "loading" ? <div className="loading">{t("Cargando…", "Loading…")}</div> :
          loadState === "error" ? (
            <div className="loading">
              <p>{t("No pude cargar tus datos. No se ha perdido nada.", "Couldn't load your data. Nothing has been lost.")}</p>
              <button className="cta small" onClick={load}>{t("Reintentar", "Try again")}</button>
            </div>
          ) :
          tab === "hablar" ? <Hablar userId={user.id} liveVoice={liveVoice} words={words} updateWords={updateWords} updateReflections={updateReflections} goReflect={(id) => { setPendingOpenId(id); setTab("reflexion"); }} goReview={goReview} recordChat={recordChat} rewind={rewind} setRewind={setRewind} startScene={pendingScene} onSceneStarted={() => setPendingScene(null)} gloss={gloss} mergeGloss={mergeGloss} lookupWord={lookupWord} customScenes={customScenes} updateScenes={updateScenes} /> :
          tab === "repasar" ? <Repasar words={words} updateWords={updateWords} recordActivity={recordActivity} gloss={gloss} lookupWord={lookupWord} startWith={reviewQueue} onStarted={() => setReviewQueue(null)} /> :
          tab === "mensajes" ? <Mensajes contacts={CONTACTS} threads={threads} updateThread={updateThread} getThread={getThread} recordActivity={recordActivity} words={words} updateWords={updateWords} gloss={gloss} mergeGloss={mergeGloss} lookupWord={lookupWord} /> :
          <Reflexion reflections={reflections} updateReflections={updateReflections} deleteChat={deleteChat} progress={progress} words={words} gloss={gloss} lookupWord={lookupWord} openId={pendingOpenId} onOpened={() => setPendingOpenId(null)} onPractice={goPractice} />}
      </main>
      <nav className="nav">
        {[["hablar", "talk", t("Hablar", "Talk")], ["mensajes", "messages", t("Mensajes", "Messages"), unreadCount], ["repasar", "cards", t("Repasar", "Review"), dueCount], ["reflexion", "progress", t("Progreso", "Progress")]].map(([id, icon, label, badge]) => (
          <button key={id} className={"navBtn " + (tab === id ? "on" : "")} aria-current={tab === id ? "page" : undefined} onClick={() => { hush(); setTab(id); if (id === "mensajes") checkDue(); }}>
            <span className="navIcon"><Icon name={icon} size={24} stroke={tab === id ? 2.1 : 1.8} />{badge > 0 && <span className="badge">{badge}</span>}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ---------- AI provider settings: free Gemini, or bring your own key ---------- */
function AISettings({ settings, setSettings, onClose }) {
  const t = useT();
  const [openId, setOpenId] = useState(settings.provider);
  const [keyInput, setKeyInput] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const p = settings.providers.find(x => x.id === openId);
  const isFree = openId === "gemini";
  const active = settings.provider === openId;
  const usable = isFree || !!p.keyHint;
  const canPickModel = !!p.keyHint; // the shared free-tier key always runs the default model

  useEffect(() => { setModelInput(p.model); setKeyInput(""); setError(null); }, [openId]); // eslint-disable-line

  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const call = async (url, method, body) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setSettings(data);
      return data;
    } catch (e) { setError(e.message); return null; }
    finally { setBusy(false); }
  };

  const saveKey = async () => {
    if (!(await call(`/api/ai/keys/${openId}`, "PUT", { apiKey: keyInput }))) return;
    setKeyInput("");
    await call("/api/ai/settings", "PUT", { provider: openId, model: modelInput });
  };
  const removeKey = () => call(`/api/ai/keys/${openId}`, "DELETE");
  const useThis = () => call("/api/ai/settings", "PUT", { provider: openId, model: canPickModel ? modelInput : undefined });

  const subtitle = x => x.keyHint ? t(`Tu clave ••••${x.keyHint}`, `Your key ••••${x.keyHint}`)
    : x.id === "gemini" ? t("Gratis · clave compartida de Charla", "Free · Charla's shared key")
    : t("Usa tu propia clave de API", "Bring your own API key");

  return (
    <div className="sheetVeil" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t("Modelo de IA", "AI model")} onClick={e => e.stopPropagation()}>
        <div className="sheetHead">
          <div className="sheetTitle">{t("Modelo de IA", "AI model")}</div>
          <button className="iconBtn" onClick={onClose} aria-label={t("Cerrar", "Close")}><Icon name="close" /></button>
        </div>
        <p className="sheetSub">{t(
          "Charla funciona gratis con Gemini. Con tu propia clave, las respuestas se cobran a tu cuenta, bajo los términos de API de ese proveedor.",
          "Charla runs free on Gemini. With your own key, replies are billed to your account under that provider's API terms."
        )}</p>
        <div className="provList">
          {settings.providers.map(x => (
            <div key={x.id} className={"provRow" + (openId === x.id ? " open" : "")}>
              <button className="provHead" onClick={() => setOpenId(x.id)}>
                <span className="provText">
                  <span className="provName">{x.label}</span>
                  <span className="provSub">{subtitle(x)}</span>
                </span>
                {settings.provider === x.id && <span className="provActive">{t("En uso", "In use")}</span>}
              </button>
              {openId === x.id && (
                <div className="provBody">
                  {!settings.keysEnabled ? (
                    !isFree && <div className="provNote">{t("Este servidor aún no acepta claves propias.", "This server isn't set up to store your own keys yet.")}</div>
                  ) : p.keyHint ? (
                    <div className="provKeyRow">
                      <span>{t("Clave", "Key")} ••••{p.keyHint}</span>
                      <button className="miniBtn" disabled={busy} onClick={removeKey}>{t("Quitar", "Remove")}</button>
                    </div>
                  ) : (
                    <>
                      {isFree && <div className="provNote">{t(
                        "Opcional: usa tu propia clave de Gemini para tener tus propios límites (con facturación activa, Google no entrena con tus chats).",
                        "Optional: use your own Gemini key for your own limits (with billing on, Google doesn't train on your chats)."
                      )}</div>}
                      <div className="creatorRow">
                        <input type="password" autoComplete="off" value={keyInput} onChange={e => setKeyInput(e.target.value)}
                               onKeyDown={e => e.key === "Enter" && keyInput.trim() && !busy && saveKey()}
                               placeholder={t(`Pega tu clave de ${x.label}`, `Paste your ${x.label} key`)} />
                        <button className="miniBtn add" disabled={busy || !keyInput.trim()} onClick={saveKey}>{busy ? "…" : t("Guardar", "Save")}</button>
                      </div>
                      <a className="provLink" href={x.keyUrl} target="_blank" rel="noreferrer">{t("Conseguir una clave", "Get a key")} ↗</a>
                    </>
                  )}
                  {canPickModel ? (
                    <label className="provModel">
                      <span className="cardLabel">{t("Modelo", "Model")}</span>
                      <input list={`models-${x.id}`} value={modelInput} onChange={e => setModelInput(e.target.value)} placeholder={x.defaultModel} />
                      <datalist id={`models-${x.id}`}>{x.suggestedModels.map(m => <option key={m} value={m} />)}</datalist>
                    </label>
                  ) : isFree && (
                    <div className="provNote">{t("Modelo", "Model")}: {x.defaultModel}</div>
                  )}
                  {usable && (!active || (canPickModel && modelInput !== x.model)) && (
                    <button className="cta small" disabled={busy} onClick={useThis}>
                      {active ? t("Guardar modelo", "Save model") : t(`Usar ${x.label}`, `Use ${x.label}`)}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {error && <div className="creatorError">{error}</div>}
      </div>
    </div>
  );
}

/* ---------- Privacy: what leaves the device, and where it goes. Reachable from the profile menu. ---------- */
function PrivacySheet({ freeTier, onClose, onAISettings }) {
  const t = useT();
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const sections = [
    ["Quién escucha tus charlas", "Who hears your chats",
      "Charla usa una IA para entenderte y responderte: Gemini, de Google, o el proveedor de tu propia clave si añades una. Lo que dices y escribes en una charla se le envía para eso. Las voces de los personajes las genera Google y, si no está disponible, las lee tu navegador.",
      "Charla uses an AI to understand you and reply: Google's Gemini, or your own key's provider if you add one. What you say and type in a chat is sent to it for that. The characters' voices are made by Google, or read by your browser when that's unavailable."],
    ["Tu voz", "Your voice",
      "Con Gemini, la charla por voz envía el audio de tu micrófono a Google en tiempo real. Con otro proveedor, tu navegador pasa tu voz a texto (en Chrome, eso también pasa por Google) y solo el texto llega a la IA. Charla no graba ni guarda tu voz.",
      "With Gemini, voice chat streams your microphone audio to Google in real time. With another provider, your browser turns your speech into text (in Chrome, that also goes through Google) and only the text reaches the AI. Charla itself doesn't record or keep your voice."],
    ["La clave gratuita", "The free key",
      "Con la clave gratuita de Charla, Google puede usar lo que envías para mejorar sus modelos. Por eso, mejor no compartas nada privado. Con tu propia clave de Gemini y la facturación activada, Google no lo usa para entrenar.",
      "On Charla's free key, Google may use what you send to improve its models, so it's best not to share anything private. With your own Gemini key and billing turned on, Google doesn't train on it."],
    ["Qué guardamos", "What we keep",
      "Tu baraja, tus charlas, tus mensajes y tu progreso se guardan en el servidor de Charla, unidos a tu cuenta de Google, para que los tengas en cualquier dispositivo. La charla que tienes abierta se guarda también en este dispositivo y se borra al cerrar sesión. Las fotos que escaneas se leen y no se guardan.",
      "Your deck, chats, messages and progress are stored on Charla's server under your Google account, so they follow you to any device. The chat you have open is also kept on this device, and cleared when you sign out. Photos you scan are read, not stored."],
    ["Tus claves", "Your keys",
      "Si añades tu propia clave de IA, se guarda cifrada y solo se usa para tus peticiones.",
      "If you add your own AI key, it's stored encrypted and only used for your requests."],
  ];
  return (
    <div className="sheetVeil" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t("Privacidad", "Privacy")} onClick={e => e.stopPropagation()}>
        <div className="sheetHead">
          <div className="sheetTitle">{t("Privacidad", "Privacy")}</div>
          <button className="iconBtn" onClick={onClose} aria-label={t("Cerrar", "Close")}><Icon name="close" /></button>
        </div>
        {freeTier && <p className="privacyNow"><Icon name="shield" size={18} /> {t("Ahora mismo usas la clave gratuita.", "You're on the free key right now.")}</p>}
        {sections.map(([es, en, bodyEs, bodyEn]) => (
          <section key={es} className="privacySection">
            <h3>{t(es, en)}</h3>
            <p>{t(bodyEs, bodyEn)}</p>
          </section>
        ))}
        <button className="cta small" onClick={onAISettings}>{t("Usar mi propia clave", "Use my own key")}</button>
      </div>
    </div>
  );
}

/* Brand mark: the period after "Charla", drawn as a speech bubble */
const BUBBLE_PATH = "M52 6A40 40 0 1 1 34.5 82L14 94L21.4 71.7A40 40 0 0 1 52 6Z";
function BubbleDot() {
  return (
    <svg className="dot" viewBox="0 0 100 100" aria-hidden="true">
      <path fill="currentColor" d={BUBBLE_PATH} />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  );
}

// Lives in the header of every screen, so English is always one tap away without covering anything.
function LangSwitch() {
  const { en, toggle } = useUI();
  return (
    <button className="langSwitch" onClick={toggle} role="switch" aria-checked={en}
            aria-label={en ? "Show the app in Spanish" : "Mostrar la app en inglés"}>
      <span className={en ? "" : "on"} lang="es">ES</span>
      <span className={en ? "on" : ""} lang="en">EN</span>
    </button>
  );
}

function LoginScreen() {
  const t = useT();
  return (
    <div className="app">
      <style>{css}</style>
      <div className="loginTop"><LangSwitch /></div>
      <div className="loginWrap">
        <div className="loginCard">
          <div className="brand">Charla<BubbleDot /></div>
          <h1 className="loginTitle">{t("Habla español de verdad, desde el primer día.", "Speak real Spanish, from day one.")}</h1>
          <p className="sub">{t("Charlas cortas con gente que te habla despacio y con paciencia. Entra para guardar tu progreso.", "Short chats with people who talk to you slowly and patiently. Sign in to keep your progress.")}</p>
          <a className="googleBtn" href="/api/auth/google"><GoogleIcon /> {t("Entrar con Google", "Sign in with Google")}</a>
          <p className="loginHint">{t("¿Algo no se entiende? Toca EN, arriba a la derecha, y lo verás todo en inglés.", "Something unclear? Tap EN, top right, to see everything in English.")}</p>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [englishMode, setEnglishMode] = useState(() => {
    try { return localStorage.getItem("charla:lang") === "en"; } catch { return false; }
  });
  const toggle = useCallback(() => {
    setEnglishMode(on => {
      try { localStorage.setItem("charla:lang", on ? "es" : "en"); } catch {}
      return !on;
    });
  }, []);

  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          setUser((await res.json()).user);
          await migrateLocalDataToServer();
        }
      } catch {}
      setAuthChecked(true);
    })();
  }, []);

  const logout = useCallback(async () => {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    setUser(null);
  }, []);

  return (
    <UIContext.Provider value={{ en: englishMode, toggle }}>
      {!authChecked ? <div className="loading">Cargando…</div> :
        !user ? <LoginScreen /> :
        <AppInner user={user} logout={logout} />}
    </UIContext.Provider>
  );
}

/* ==================== HABLAR ==================== */
// A chat restored after a reload or a tab switch may end on the learner's line: its reply was
// still on the way when the screen closed. Give it a retry instead of leaving it hanging.
function restoreSession(saved, t) {
  if (!saved?.scenario) return null;
  const msgs = saved.msgs || [];
  const last = msgs[msgs.length - 1];
  if (last?.role !== "me" || last.error) return saved;
  const history = saved.apiHistory || [];
  return {
    ...saved,
    msgs: [...msgs, { role: "ai", es: t("Tu mensaje se quedó sin respuesta.", "Your message didn't get a reply."), error: true }],
    apiHistory: history[history.length - 1]?.role === "user" ? history : appendUser(history, last.es),
  };
}

function Hablar({ userId, liveVoice, words, updateWords, updateReflections, goReflect, goReview, recordChat, rewind, setRewind, startScene, onSceneStarted, gloss, mergeGloss, lookupWord, customScenes, updateScenes }) {
  const t = useT();
  const sessionKey = `sesionActiva:${userId}`;
  const [restored] = useState(() => restoreSession(loadSync(sessionKey, null), t));
  const [scenario, setScenario] = useState(restored?.scenario || null);
  const [msgs, setMsgs] = useState(restored?.msgs || []);
  const [apiHistory, setApiHistory] = useState(restored?.apiHistory || []);
  const [startedAt, setStartedAt] = useState(restored?.startedAt || null);
  const [lifelineOpen, setLifelineOpen] = useState(false);
  const [pinned, setPinned] = useState(null); // the lifeline's Spanish line, kept in view while they say it
  const [stuck, setStuck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState(null);
  const [needMore, setNeedMore] = useState(false);
  const [typeMode, setTypeMode] = useState(false);
  const [input, setInput] = useState("");
  const [ideaText, setIdeaText] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);
  const [help, setHelp] = useState(null);
  const [helpBusy, setHelpBusy] = useState(false);
  const endRef = useRef(null);
  const sceneDelete = useUndoableDelete(id => updateScenes(list => list.filter(x => x.id !== id)));

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  useEffect(() => () => hush(), []);

  // Keep the active conversation durable across a refresh, a tab switch, or an accidental close.
  useEffect(() => {
    saveLocal(sessionKey, scenario ? { scenario, msgs, apiHistory, startedAt } : null);
  }, [sessionKey, scenario, msgs, apiHistory, startedAt]);

  /* ----- Real-time voice (Gemini Live) when Gemini is the provider. Otherwise — or if Live fails to
     start twice running — the classic pipeline: browser speech recognition → chat model → TTS. ----- */
  const [liveDown, setLiveDown] = useState(false);
  const useLive = liveVoice && !liveDown && liveSupported();
  const [liveTalking, setLiveTalking] = useState(false);
  const [liveError, setLiveError] = useState(null);
  const liveRef = useRef(null);
  const liveFails = useRef(0);
  const thinkingTimer = useRef(null);
  const turnRef = useRef({ me: null, ai: null }); // ids of the bubbles for the turn in progress
  const scenarioRef = useRef(scenario);
  const msgsRef = useRef(msgs);
  const apiHistoryRef = useRef(apiHistory);
  scenarioRef.current = scenario;
  msgsRef.current = msgs;
  apiHistoryRef.current = apiHistory;

  useEffect(() => {
    setCharacterVoice(scenario ? voiceFor(scenario) : null);
    return () => setCharacterVoice(null);
  }, [scenario]);
  useEffect(() => () => { liveRef.current?.close(); clearTimeout(thinkingTimer.current); }, []);

  const upsertTurnMsg = (role, text) => {
    const id = turnRef.current[role];
    if (id) return setMsgs(m => m.map(x => (x.id === id ? { ...x, es: text } : x)));
    const newId = Math.random().toString(36).slice(2);
    turnRef.current[role] = newId;
    setMsgs(m => [...dropTrailingError(m), { id: newId, role, es: text, ...(role === "ai" && { hint: null, correction: null, new_words: [] }) }]);
  };

  // Live speaks plain Spanish; the hint, glossary, correction and new words fill in afterwards.
  const annotate = async (sc, turn, aiId) => {
    try {
      const p = parseAIJson(await askAI([{ role: "user", content: annotationPrompt(sc, turn.user, turn.ai) }], { json: true }));
      if (!p) return;
      setMsgs(m => m.map(x => (x.id === aiId ? {
        ...x,
        hint: p.hint || null,
        correction: p.correction?.better ? p.correction : null,
        new_words: Array.isArray(p.new_words) ? p.new_words : [],
        gloss: normGloss(p.gloss),
      } : x)));
      mergeGloss(p.gloss);
    } catch {} // the conversation carries on without the extras — words can still be tapped for lookups
  };

  const onLiveEvent = (type, payload) => {
    if (type === "talking") {
      setLiveTalking(payload);
      if (payload) { setHelp(null); setLiveError(null); }
    } else if (type === "thinking") {
      setBusy(true);
      clearTimeout(thinkingTimer.current);
      thinkingTimer.current = setTimeout(() => {
        setBusy(false);
        setLiveError(t("No llegó respuesta. Inténtalo otra vez.", "No reply came back. Try again."));
      }, 15000);
    } else if (type === "user") {
      // A new learner turn while the last reply's bubble is still open means they cut in.
      if (turnRef.current.ai) turnRef.current = { me: null, ai: null };
      upsertTurnMsg("me", payload);
    } else if (type === "ai") {
      clearTimeout(thinkingTimer.current);
      setBusy(false);
      setLiveError(null); // a slow reply can still land after the "no reply" notice
      liveFails.current = 0;
      upsertTurnMsg("ai", payload);
    } else if (type === "turn") {
      clearTimeout(thinkingTimer.current);
      setBusy(false);
      const aiId = turnRef.current.ai;
      turnRef.current = { me: null, ai: null };
      setPinned(null);
      // Kept in the classic shape so "help me answer" (and a switch to another provider) keep working.
      setApiHistory(h => [...appendUser(h, payload.user || "…"), { role: "assistant", content: JSON.stringify({ reply: payload.ai }) }]);
      if (aiId && scenarioRef.current) annotate(scenarioRef.current, payload, aiId);
    } else if (type === "error") {
      clearTimeout(thinkingTimer.current);
      setBusy(false);
      if (payload?.name === "NotAllowedError") {
        return setLiveError(t("Charla no tiene permiso para usar el micrófono. Puedes darlo en los ajustes del navegador.", "Charla isn't allowed to use the mic. You can allow it in your browser settings."));
      }
      liveFails.current += 1;
      if (payload?.kind === "not-gemini" || liveFails.current >= 2) {
        liveRef.current?.close();
        liveRef.current = null;
        setLiveError(null);
        setLiveDown(true);
        return;
      }
      setLiveError(t("Se cortó la voz. Toca el micrófono para seguir.", "The voice connection dropped. Tap the mic to carry on."));
    }
  };
  const liveEventRef = useRef(onLiveEvent);
  liveEventRef.current = onLiveEvent;

  const getLive = () => {
    liveRef.current ??= new LiveSession({
      getSetup: () => ({ systemInstruction: buildLivePrompt(scenarioRef.current, msgsRef.current), voice: voiceFor(scenarioRef.current) }),
      onEvent: (type, payload) => liveEventRef.current(type, payload),
    });
    return liveRef.current;
  };

  const showReply = (raw) => {
    const p = parseReply(raw);
    setMsgs(m => [...dropTrailingError(m), { role: "ai", es: p.reply, hint: p.hint, correction: p.correction, new_words: p.new_words || [], gloss: normGloss(p.gloss) }]);
    setApiHistory(h => [...h, { role: "assistant", content: raw }]);
    mergeGloss(p.gloss);
    speak(p.reply);
  };

  const send = useCallback(async (text) => {
    text = text.trim();
    if (!text) return;
    setHelp(null);
    setPinned(null);
    if (useLive) {
      const id = Math.random().toString(36).slice(2);
      turnRef.current = { me: id, ai: null };
      setMsgs(m => [...dropTrailingError(m), { id, role: "me", es: text }]);
      setBusy(true); // "thinking" arrives only once the session is connected
      getLive().sendText(text);
      return;
    }
    setMsgs(m => [...dropTrailingError(m), { role: "me", es: text }]);
    setBusy(true);
    // The request goes out here, not inside a state updater: React may run updaters twice,
    // which sent every message twice.
    const hist = appendUser(apiHistoryRef.current, text);
    apiHistoryRef.current = hist;
    setApiHistory(hist);
    try {
      showReply(await askAI(hist, { json: true }));
    } catch (err) {
      setMsgs(m => [...m, { role: "ai", es: errorText(err, t), error: true }]);
    }
    setBusy(false);
  }, [mergeGloss, t, useLive]); // eslint-disable-line react-hooks/exhaustive-deps -- getLive and showReply only touch refs/setters

  const retryLast = useCallback(async () => {
    setBusy(true);
    try {
      showReply(await askAI(apiHistoryRef.current, { json: true }));
    } catch (err) {
      // leave the error bubble in place, with the latest reason — the retry button stays available
      setMsgs(m => m.map((x, i) => (i === m.length - 1 && x.error ? { ...x, es: errorText(err, t) } : x)));
    }
    setBusy(false);
  }, [mergeGloss, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const mic = useMic(send);

  const start = (sc) => {
    setScenario(sc);
    setStartedAt(Date.now());
    setRewind(null);
    setHelp(null);
    setEndError(null);
    setMsgs([{ role: "ai", es: sc.opener, hint: sc.hint, correction: null, new_words: [] }]);
    setApiHistory([
      { role: "user", content: buildSystemPrompt(sc) },
      { role: "assistant", content: JSON.stringify({ reply: sc.opener, hint: "", correction: null, new_words: [] }) },
    ]);
    setCharacterVoice(voiceFor(sc)); // the scenario effect only runs after this tap — the opener needs the voice now
    speak(sc.opener); // scenario tap = user gesture, unlocks audio on iOS
    if (useLive) {
      // Connect while the opener plays, so the first tap on the mic is instant.
      liveRef.current?.close();
      liveRef.current = null;
      scenarioRef.current = sc;
      msgsRef.current = [{ role: "ai", es: sc.opener }];
      getLive().connect().catch(err => liveEventRef.current("error", err));
    }
  };

  // "Practise" from the can-do map lands here. A chat already in progress isn't thrown away for it.
  useEffect(() => {
    if (!startScene) return;
    const sc = [...SCENARIOS, ...customScenes].find(x => x.id === startScene);
    if (sc && !scenario) start(sc);
    onSceneStarted?.();
  }, [startScene]); // eslint-disable-line react-hooks/exhaustive-deps

  const leave = () => {
    hush(); mic.stop();
    liveRef.current?.close();
    liveRef.current = null;
    turnRef.current = { me: null, ai: null };
    clearTimeout(thinkingTimer.current);
    setBusy(false); setLiveTalking(false); setLiveError(null); setEndError(null);
    setLifelineOpen(false); setPinned(null); setHelp(null);
    setScenario(null); setMsgs([]); setApiHistory([]); setStartedAt(null);
    saveLocal(sessionKey, null); // also when this screen already closed while the rewind was being written
  };

  const saveWord = (w) => {
    updateWords(ws => (ws.some(x => strip(x.es) === strip(w.es)) ? ws : [...ws, { ...w, due: Date.now(), interval: 0, reps: 0, added: Date.now() }]));
  };

  // skipSummary: the learner chose to finish without the AI rewind (it failed). The chat still
  // counts: minutes, the transcript and a reflection with the default questions.
  const endSession = async (skipSummary = false) => {
    if (msgs.length < 3 || busy) return;
    hush(); mic.stop(); liveRef.current?.stopTalking();
    setBusy(true); setEnding(true); setEndError(null);
    try {
      const p = skipSummary ? {} : parseAIJson(await askAI([{ role: "user", content: rewindPrompt(scenario, msgs) }], { json: true })) || {};
      const lines = rewindLines(msgs);
      const fixes = (Array.isArray(p.fixes) ? p.fixes : [])
        .filter(f => typeof f?.you_said === "string" && typeof f?.better === "string" && f.better.trim() && strip(f.better) !== strip(f.you_said))
        .slice(0, 5)
        .map(f => {
          // The partner's line just before the learner's — it becomes the review card's "they asked you".
          const n = Number(f.line) - 1;
          const at = lines[n]?.role === "me" ? n : lines.findIndex(m => m.role === "me" && strip(m.es).includes(strip(f.you_said)));
          const context = at > 0 ? lines.slice(0, at).reverse().find(m => m.role === "ai")?.es || "" : "";
          return {
            you_said: f.you_said.trim(), better: f.better.trim(), en: typeof f.en === "string" ? f.en.trim() : "",
            why: typeof f.why === "string" ? f.why.trim() : "", tag: ERROR_TAGS.includes(f.tag) ? f.tag : "other",
            context, keep: true,
          };
        });
      const learnerTurns = lines.filter(m => m.role === "me").length;
      // Wall-clock time, capped per turn so a tab left open overnight doesn't log hours.
      const elapsed = startedAt ? Math.round((Date.now() - startedAt) / 60000) : learnerTurns;
      const minutes = Math.max(1, Math.min(elapsed, learnerTurns * 2));
      const id = Date.now();
      updateReflections(rs => [{
        id, scenario: scenario.title, sceneTitleEn: sceneTitleEn(scenario), transcript: lines,
        partner: partnerName(scenario),
        summary: p.summary || "You held a real spoken conversation in Spanish.",
        summary_es: p.summary ? p.summary_es || "" : "Tuviste una conversación de verdad, en español.",
        can_now_say: Array.isArray(p.can_now_say) ? p.can_now_say : [],
        ...(Array.isArray(p.questions) && p.questions.length
          ? { questions: p.questions, questions_es: Array.isArray(p.questions_es) ? p.questions_es : [] }
          : { questions: ["What was the hardest moment to say out loud?", "What would you say differently next time?"], questions_es: ["¿Qué momento te costó más decir en voz alta?", "¿Qué dirías diferente la próxima vez?"] }),
        fixes, note: "",
      }, ...rs]);
      const completed = recordChat({ minutes, canDo: p.can_do, scene: scenario.title, fixes, ref: id });
      setRewind({
        reflectionId: id, scene: scenario, voice: voiceFor(scenario), minutes, fixes, completed,
        newWords: msgs.reduce((n, m) => n + (m.new_words?.length || 0), 0),
      });
      leave();
    } catch (err) {
      setEndError(errorText(err, t));
    }
    setBusy(false); setEnding(false);
  };

  // Rewind's "save" — the kept fixes become mistake cards; optionally straight into a review session.
  // Closing the rewind any other way saves them too: they're kept unless the learner switched them off.
  const saveRewind = (practise) => {
    const kept = rewind.fixes.filter(f => f.keep);
    const now = Date.now();
    const cards = kept.map(f => ({
      es: f.better, en: f.en, example: "", kind: "mistake", you_said: f.you_said, why: f.why, tag: f.tag,
      context: f.context, partner: partnerName(rewind.scene), scene: rewind.scene.title, voice: rewind.voice,
      due: now, interval: 0, reps: 0, added: now,
    }));
    if (cards.length) updateWords(ws => {
      const fresh = cards.filter(c => !ws.some(w => strip(w.es) === strip(c.es)));
      return fresh.length ? [...ws, ...fresh] : ws;
    });
    setRewind(null);
    if (practise && kept.length) goReview(kept.map(f => f.better));
  };

  /* ----- Lifeline: freeze → say it in English → get the Spanish → say it yourself ----- */
  const openLifeline = () => {
    hush();
    if (useLive) { if (liveTalking) liveRef.current?.stopTalking(); }
    else if (mic.listening) mic.cancel();
    setHelp(null);
    setStuck(false);
    setLifelineOpen(true);
  };

  // "Your turn": the line stays pinned above the mic while they say it back. No score; the
  // conversation simply carries on.
  const lifelineTurn = (es) => {
    setLifelineOpen(false);
    setPinned(es);
    if (useLive) getLive().startTalking();
    else if (mic.supported) mic.start();
    else setTypeMode(true);
  };

  const tryEnd = () => {
    if (msgs.length < 3) { setNeedMore(true); setTimeout(() => setNeedMore(false), 2500); return; }
    endSession();
  };

  const createScene = async () => {
    const idea = ideaText.trim();
    if (!idea || creating) return;
    setCreating(true); setCreateError(false);
    try {
      const raw = await askAI([{
        role: "user",
        content: `Create a Spanish conversation practice scenario for a BEGINNER (A1-A2) from this idea: "${idea}". Make it a meaningful conversation with a clear goal, not small talk. ${HOUSE_STYLE}
Respond ONLY with JSON, no fences:\n{"title":"short Spanish title (2-4 words)","title_en":"English translation of the title","goal":"one-line goal in English","goal_es":"the same goal in simple Spanish","who":"character name, a comma, then a one-line description in English","who_es":"the same in simple Spanish","voice":"female or male, matching the character","art":"the closest picture for the scene, one of: ${ART_KEYS.join(", ")}","opener":"the character's first line in simple Spanish, max 2 short sentences, ending with a question","hint":"English translation of the opener"}`,
      }], { json: true });
      const scene = sanitizeScene(parseAIJson(raw), ART_KEYS, "custom-" + Date.now());
      if (!scene) throw new Error("Unreadable scene");
      updateScenes(list => [...list, scene]);
      setIdeaText("");
    } catch {
      setCreateError(true);
    }
    setCreating(false);
  };

  const getHelp = async () => {
    if (helpBusy || busy) return;
    setHelpBusy(true);
    try {
      const raw = await askAI([...apiHistory, {
        role: "user",
        content: `(Meta request — do NOT continue the conversation. The learner is stuck on how to answer your last message. ${HOUSE_STYLE}
Respond ONLY with JSON, no fences:\n{"starters":["2 short Spanish sentence starters they could begin with"],"example":"one full, simple example answer in Spanish","example_en":"English translation of the example"})`,
      }], { json: true });
      const p = parseAIJson(raw);
      if (!p) throw new Error("Unreadable help");
      setHelp({ stage: "hint", ...p, example_en: plain(p.example_en) });
    } catch {
      setHelp({ stage: "hint", starters: [], error: true });
    }
    setHelpBusy(false);
  };

  const listening = useLive ? liveTalking : mic.listening;
  const voiceError = useLive ? liveError : mic.error;

  // The lifeline pulses when the learner seems stuck: ~4s with nothing new while the mic is open,
  // or a longer pause on their turn before they start. Any new word resets it.
  useEffect(() => {
    setStuck(false);
    if (!scenario || busy || lifelineOpen || help) return;
    const id = setTimeout(() => setStuck(true), listening ? 4000 : 12000);
    return () => clearTimeout(id);
  }, [scenario, busy, lifelineOpen, help, listening, mic.interim, msgs]);

  const sceneTip = useTip("hablar");
  const chatTip = useTip("chat");

  if (rewind && !scenario) return (
    <Rewind rewind={rewind} setRewind={setRewind} onSave={saveRewind}
            onReflect={() => { const id = rewind.reflectionId; saveRewind(false); goReflect(id); }} gloss={gloss} lookupWord={lookupWord} />
  );

  if (!scenario) return (
    <div className="pad">
      <ScreenTitle><TapPhrase es={<>Habla <em>de verdad</em>.</>} en="Speak for real." /></ScreenTitle>
      <p className="sub">{t("Elige una escena y habla. Te responden en voz alta, con calma y en un español sencillo.", "Pick a scene and talk. They answer out loud, calmly, in simple Spanish.")}</p>
      <Tip tip={sceneTip} points={[
        "Pick a scene and tap the mic to talk.",
        "Tap any Spanish word to see what it means.",
        "Lost? Tap EN at the top right to switch everything to English. Tap ES to come back.",
      ]} />
      {!SR && !(liveVoice && liveSupported()) && (
        <div className="warn">{t("Este navegador no deja usar el micrófono para hablar. Puedes escribir, y las respuestas se siguen oyendo. Chrome o Safari funcionan mejor.", "This browser can't use the mic for talking. You can type instead, and replies are still read aloud. Chrome or Safari work best.")}</div>
      )}
      {sceneDelete.pending && (
        <div className="undoToast">
          <span>{t(`Borrada: ${sceneDelete.pending.label}`, `Deleted: ${sceneDelete.pending.label}`)}</span>
          <button onClick={sceneDelete.undo}>{t("Deshacer", "Undo")}</button>
        </div>
      )}
      <div className="scenes">
        {[...SCENARIOS, ...customScenes].filter(sc => sc.id !== sceneDelete.pending?.id).map(sc => (
          <div key={sc.id} className="sceneWrap">
            <button className="scene" onClick={() => start(sc)}>
              <SceneArt scene={sc} className="sceneArt" />
              <span className="sceneInfo">
                <Avatar name={partnerName(sc)} />
                <span className="sceneBody">
                  <span className="sceneTitle"><TapPhrase es={sc.title} en={sceneTitleEn(sc)} /></span>
                  <span className="sceneGoal">{sceneGoal(sc, t)}</span>
                  <span className="sceneWho">{t(`con ${sceneWho(sc, t)}`, `with ${sc.who}`)}</span>
                </span>
              </span>
            </button>
            {sc.custom && (
              <button className="iconBtn sceneDel" onClick={() => sceneDelete.remove(sc.id, sc.title)} aria-label={t("Borrar esta escena", "Delete this scene")}>
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        ))}
        <div className="creator">
          <div className="creatorTitle">{t("Crea tu escena", "Make your own scene")}</div>
          <div className="creatorSub">{t("Cuéntanos la idea en una frase. Charla prepara el personaje, el objetivo y la primera frase.", "Describe the idea in a sentence. Charla sets up the character, the goal and the first line.")}</div>
          <div className="creatorRow">
            <input value={ideaText} onChange={e => setIdeaText(e.target.value)}
                   onKeyDown={e => e.key === "Enter" && createScene()}
                   aria-label={t("Idea para la escena", "Scene idea")}
                   placeholder={t("Por ejemplo: una entrevista en una panadería", "For example: a job interview at a bakery")} />
            <button className="sendBtn" onClick={createScene} disabled={creating || !ideaText.trim()} aria-label={t("Crear escena", "Create scene")}>
              {creating ? "…" : <Icon name="sparkle" />}
            </button>
          </div>
          {createError && <div className="creatorError">{t("No pude crear esa escena. Inténtalo otra vez.", "Couldn't create that scene. Try again.")}</div>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="chatWrap">
      <div className="chatHead">
        <button className="iconBtn" onClick={leave} aria-label={t("Volver a las escenas", "Back to scenes")}><Icon name="back" size={24} /></button>
        <Avatar name={partnerName(scenario)} size={38} />
        <div className="chatHeadText">
          <div className="chatTitle"><TapPhrase es={scenario.title} en={sceneTitleEn(scenario)} /></div>
          <div className="chatGoal">{sceneGoal(scenario, t)}</div>
        </div>
        <button className="endBtn" onClick={tryEnd} disabled={busy}>{ending ? "…" : t("Terminar", "Finish")}</button>
      </div>
      {needMore && <div className="needMoreNote">{t("Habla un poco más antes de terminar.", "Talk a little more before finishing.")}</div>}
      {endError && (
        <div className="needMoreNote err">
          {t("No pude preparar el repaso de la charla.", "Couldn't put together the chat rewind.")} {endError}
          <div className="endErrorRow">
            <button className="tool" onClick={() => endSession()} disabled={ending}><Icon name="retry" size={15} /> {t("Reintentar", "Retry")}</button>
            <button className="tool" onClick={() => endSession(true)} disabled={ending}>{t("Terminar sin repaso", "Finish without it")}</button>
          </div>
        </div>
      )}

      <div className="msgs">
        <SceneArt scene={scenario} className="chatArt" />
        <Tip tip={chatTip} title="How the chat works" points={[
          "Tap the mic, talk, and tap it again when you're done.",
          "Missing a word? Tap ? and say it in English.",
          "When you finish you'll see your sentences smoothed out, and can save them to review.",
        ]} />
        {msgs.map((m, i) => (
          <ChatMessage key={m.id || i} m={m} mine={m.role === "me"} isLast={i === msgs.length - 1} busy={busy} onRetry={retryLast}
                       words={words} saveWord={saveWord} gloss={gloss} lookupWord={lookupWord} />
        ))}
        {busy && !ending && <div className="row ai"><div className="bubble ai typing">● ● ●</div></div>}
        <div ref={endRef} />
      </div>

      {lifelineOpen && (
        <LifelineSheet persona={scenario} partnerLabel={partnerName(scenario)} sceneLabel={scenario.title} voice={voiceFor(scenario)}
                       partner={[...msgs].reverse().find(m => m.role === "ai" && !m.error)?.es || ""}
                       words={words} updateWords={updateWords} mergeGloss={mergeGloss} gloss={gloss} lookupWord={lookupWord}
                       onClose={() => setLifelineOpen(false)} onTurn={lifelineTurn}
                       onIdeas={() => { setLifelineOpen(false); getHelp(); }} ideasDisabled={busy} />
      )}

      {/* Audio-first composer */}
      <div className="talkBar">
        {pinned && !help && <PinCard text={pinned} onDismiss={() => setPinned(null)} />}
        {help && (
          <div className="helpCard">
            <button className="iconBtn small cardClose" onClick={() => setHelp(null)} aria-label={t("Cerrar", "Close")}><Icon name="close" size={16} /></button>
            <div className="cardLabel">{t("Ideas para responder", "Ideas for your answer")}</div>
            {help.error && <div className="helpError">{t("No pude traer ideas. Inténtalo otra vez.", "Couldn't get ideas. Try again.")}</div>}
            {help.starters?.map((s, i) => (
              <div key={i} className="starter">“<TapText text={s} gloss={gloss} lookup={lookupWord} />…” <SpeakBtn text={s} /></div>
            ))}
            {help.error ? null : help.stage === "hint" ? (
              <button className="pistaBtn wide" onClick={() => setHelp(h => ({ ...h, stage: "full" }))}>{t("Ver una respuesta completa", "See a full answer")}</button>
            ) : (
              <div className="helpFull">
                “<TapText text={help.example} gloss={gloss} lookup={lookupWord} />” <SpeakBtn text={help.example} rate={0.85} />
                <div className="helpEn">{help.example_en}</div>
              </div>
            )}
          </div>
        )}
        {typeMode || !(useLive || mic.supported) ? (
          <div className="typeRow">
            <button className={"lifelineBtn small" + (stuck ? " pulse" : "")} onClick={openLifeline} disabled={ending || helpBusy}
                    aria-label={t("¿Cómo se dice? Dilo en inglés", "How do you say it? Say it in English")}>?</button>
            <input value={input} onChange={e => setInput(e.target.value)}
                   onKeyDown={e => { if (e.key === "Enter" && input.trim() && !busy) { send(input); setInput(""); } }}
                   placeholder={t("Escribe en español…", "Write in Spanish…")} aria-label={t("Escribe en español", "Write in Spanish")} autoFocus />
            <button className="sendBtn" disabled={busy || !input.trim()} onClick={() => { send(input); setInput(""); }} aria-label={t("Enviar", "Send")}><Icon name="send" /></button>
            {(useLive || mic.supported) && <button className="iconBtn" onClick={() => setTypeMode(false)} aria-label={t("Hablar", "Talk")}><Icon name="mic" size={22} /></button>}
          </div>
        ) : (
          <>
            <div className={"liveText" + (voiceError ? " err" : "")}>
              {voiceError ? voiceError : helpBusy ? t("Buscando ayuda…", "Finding help…") : listening ? ((!useLive && mic.interim) || t("Te escucho…", "I'm listening…")) : busy ? t("Pensando…", "Thinking…") : t("Toca y habla", "Tap and talk")}
            </div>
            {stuck && <div className="stuckTip">{t("¿Te falta una palabra? Toca ? y dilo en inglés.", "Missing a word? Tap ? and say it in English.")}</div>}
            <div className="talkRow">
              <span className="toolCol">
                <button className="sideTool" onClick={() => setTypeMode(true)} aria-label={t("Escribir", "Type instead")}><Icon name="keyboard" size={22} /></button>
                <span>{t("Escribir", "Type")}</span>
              </span>
              {/* In Live mode the learner can cut in at any time, so the button stays enabled. */}
              <button className={"talkBtn " + (listening ? "live" : "")} disabled={busy && !useLive}
                      aria-label={listening ? t("Terminar de hablar", "Done talking") : t("Hablar", "Talk")}
                      onClick={() => (useLive
                        ? (liveTalking ? liveRef.current?.stopTalking() : getLive().startTalking())
                        : (mic.listening ? mic.stop() : mic.start()))}>
                <Icon name={listening ? "stop" : "mic"} size={32} stroke={2} />
              </button>
              <span className="toolCol">
                <button className={"lifelineBtn" + (stuck ? " pulse" : "")} onClick={openLifeline} disabled={ending || helpBusy}
                        aria-label={t("¿Cómo se dice? Dilo en inglés", "How do you say it? Say it in English")}>?</button>
                <span className="lifeLabel">{t("¿Cómo se dice?", "How do you say it?")}</span>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Hides an item at once and only really deletes it after a few seconds, so "Undo" has nothing to
// restore. Leaving the screen commits it.
function useUndoableDelete(commit, ms = 5000) {
  const [pending, setPending] = useState(null); // { id, label }
  const pendingRef = useRef(null);
  const timer = useRef(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const finish = () => {
    clearTimeout(timer.current);
    if (pendingRef.current) commitRef.current(pendingRef.current.id);
    pendingRef.current = null;
  };
  useEffect(() => finish, []);
  const remove = (id, label) => {
    finish();
    pendingRef.current = { id, label };
    setPending(pendingRef.current);
    timer.current = setTimeout(() => { finish(); setPending(null); }, ms);
  };
  const undo = () => { clearTimeout(timer.current); pendingRef.current = null; setPending(null); };
  return { pending, remove, undo };
}

function PinCard({ text, onDismiss }) {
  const t = useT();
  return (
    <div className="pinCard">
      <button className="pinText" onClick={() => speak(text)} aria-label={t("Escuchar tu frase", "Play your line")}><Icon name="speaker" size={18} /> {text}</button>
      <button className="iconBtn small" onClick={onDismiss} aria-label={t("Quitar", "Dismiss")}><Icon name="close" size={16} /></button>
    </div>
  );
}

/* ---------- ¿Cómo se dice?: say it in English, get the Spanish back, then try it yourself.
   Shared by Hablar and Mensajes. The line is saved as a review card straight away (with undo). ---------- */
function LifelineSheet({ persona, partnerLabel, sceneLabel, voice, partner, words, updateWords, mergeGloss, gloss, lookupWord, onClose, onTurn, onIdeas, ideasDisabled }) {
  const t = useT();
  const [state, setState] = useState({ stage: "ask" }); // stage: "ask" | "busy" | "result" | "error"
  const [input, setInput] = useState("");
  const req = useRef(0);

  const ask = async (english) => {
    english = english.trim();
    if (!english) return;
    setState({ stage: "busy", en: english });
    const id = ++req.current;
    try {
      const p = parseAIJson(await askAI([{ role: "user", content: lifelinePrompt(persona, partner, english) }], { json: true }));
      if (id !== req.current) return; // closed while it was translating — don't reopen or save
      if (typeof p?.es !== "string" || !p.es.trim()) throw new Error("Unreadable lifeline");
      mergeGloss(p.gloss);
      const es = p.es.trim();
      const isNew = !words.some(w => strip(w.es) === strip(es));
      if (isNew) {
        updateWords(ws => (ws.some(w => strip(w.es) === strip(es)) ? ws : [...ws, {
          es, en: english, example: "", kind: "lifeline", context: partner, partner: partnerLabel, scene: sceneLabel,
          voice, due: Date.now(), interval: 0, reps: 0, added: Date.now(),
        }]));
      }
      setState({ stage: "result", en: english, es, chunks: Array.isArray(p.chunks) ? p.chunks.filter(c => c?.es) : [], note: plain(p.note) || "", saved: isNew ? es : null });
      speak(es);
    } catch {
      if (id === req.current) setState({ stage: "error", en: english });
    }
  };
  const enMic = useMic(ask, "en-US");

  const close = () => { enMic.cancel(); req.current++; onClose(); };
  useEffect(() => () => { req.current++; }, []);

  const undoSave = () => {
    const saved = state.saved;
    updateWords(ws => ws.filter(w => w.es !== saved));
    setState(s => ({ ...s, saved: null, undone: true }));
  };

  return (
    <div className="sheetVeil" onClick={close}>
      <div className="sheet lifeSheet" role="dialog" aria-modal="true" aria-label={t("¿Cómo se dice?", "How do you say it?")} onClick={e => e.stopPropagation()}>
        <div className="sheetHead">
          <span className="lifeKicker">{t("¿Cómo se dice?", "How do you say it?")}</span>
          <button className="iconBtn" onClick={close} aria-label={t("Cerrar", "Close")}><Icon name="close" /></button>
        </div>
        {state.stage === "ask" ? (
          <>
            <p className="sheetSub">{t("Dilo en inglés y te doy el español.", "Say it in English and I'll give you the Spanish.")}</p>
            {enMic.supported && (
              <div className="lifeAsk">
                <button className={"talkBtn ink " + (enMic.listening ? "live" : "")} onClick={() => (enMic.listening ? enMic.stop() : enMic.start())}
                        aria-label={enMic.listening ? t("Parar", "Stop") : t("Habla en inglés", "Speak in English")}>
                  <Icon name={enMic.listening ? "stop" : "mic"} size={30} stroke={2} />
                </button>
                <div className={"liveText" + (enMic.error ? " err" : "")}>
                  {enMic.error || (enMic.listening ? (enMic.interim || t("Te escucho… en inglés", "Listening… in English")) : t("Toca y dilo en inglés", "Tap and say it in English"))}
                </div>
              </div>
            )}
            <div className="creatorRow">
              <input value={input} onChange={e => setInput(e.target.value)}
                     onKeyDown={e => e.key === "Enter" && ask(input)} aria-label={t("Escríbelo en inglés", "Type it in English")}
                     placeholder={enMic.supported ? t("…o escríbelo en inglés", "…or type it in English") : t("Escríbelo en inglés", "Type it in English")} />
              <button className="sendBtn" disabled={!input.trim()} onClick={() => ask(input)} aria-label={t("Enviar", "Send")}><Icon name="send" /></button>
            </div>
            {onIdeas && (
              <button className="linkBtn lifeIdeas" disabled={ideasDisabled} onClick={() => { enMic.cancel(); req.current++; onIdeas(); }}>
                {t("¿No sabes qué decir? Pide ideas", "Not sure what to say? Get ideas")}
              </button>
            )}
          </>
        ) : (
          <>
            <div className="lifeSaid">
              <span className="cardLabel">{t("Dijiste", "You said")}</span>
              <span className="lifeEn">“{state.en}”</span>
            </div>
            {state.stage === "busy" && <div className="liveText">{t("Buscando cómo se dice…", "Finding how to say it…")}</div>}
            {state.stage === "error" && (
              <div className="lifeError">
                <span>{t("No pude traducirlo. Inténtalo otra vez.", "Couldn't translate that. Try again.")}</span>
                <button className="tool" onClick={() => ask(state.en)}><Icon name="retry" size={15} /> {t("Reintentar", "Retry")}</button>
              </div>
            )}
            {state.stage === "result" && (
              <>
                <div>
                  <span className="cardLabel">{t("En español", "In Spanish")}</span>
                  <p className="lifeEs"><TapText text={state.es} gloss={gloss} lookup={lookupWord} /></p>
                </div>
                {state.chunks.length > 1 && (
                  <div className="lifeChunks">
                    {state.chunks.map((c, i) => (
                      <button key={i} className="lifeChunk" onClick={() => speak(c.es, 0.85)}>
                        <b>{c.es}</b><span>{c.en}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="lifePlay">
                  <button className="pillBtn strong" onClick={() => speak(state.es)}><Icon name="speaker" size={18} /> {t("Escuchar", "Play")}</button>
                  <button className="pillBtn" onClick={() => speak(state.es, 0.65)}><Icon name="slow" size={18} /> {t("Más lento", "Slower")}</button>
                </div>
                {state.note && <p className="lifeNote">{state.note}</p>}
                <button className="cta lifeGo" onClick={() => { req.current++; onTurn(state.es); }}><Icon name="mic" size={22} /> {t("Ahora tú: dilo en voz alta", "Your turn: say it out loud")}</button>
                {state.saved ? (
                  <div className="savedToast" role="status">
                    <span><Icon name="check" size={16} stroke={2.4} /> {t("Guardado en Repasar", "Saved to Review")}</span>
                    <button onClick={undoSave}>{t("Deshacer", "Undo")}</button>
                  </div>
                ) : !state.undone && (
                  <div className="savedToast quiet" role="status">{t("Ya está en tu baraja", "Already in your deck")}</div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ==================== REWIND: the chat played back, smoothed out ==================== */
function Rewind({ rewind, setRewind, onSave, onReflect, gloss, lookupWord }) {
  const t = useT();
  const [celebrated, setCelebrated] = useState(0);
  const { scene, fixes, completed } = rewind;
  const kept = fixes.filter(f => f.keep).length;
  const toggle = (i) => setRewind(r => ({ ...r, fixes: r.fixes.map((f, j) => (j === i ? { ...f, keep: !f.keep } : f)) }));

  if (celebrated < completed.length) {
    return <CanDoUnlocked item={completed[celebrated]} onClose={() => setCelebrated(n => n + 1)} />;
  }

  return (
    <div className="rewindWrap">
      <div className="pad rewind">
        <div className="rewindHead">
          {/* Closing keeps the cards that are switched on, same as the main button. */}
          <button className="iconBtn" onClick={() => onSave(false)} aria-label={t("Cerrar", "Close")}><Icon name="close" /></button>
          <span className="rewindKicker">{t("Repaso de la charla", "Chat rewind")}</span>
          <span className="rewindSpacer" />
        </div>
        <h1 className="display">{t(`¡Buena charla con ${partnerName(scene)}!`, `Nice chat with ${partnerName(scene)}`)}</h1>
        <p className="sub"><TapPhrase es={scene.title} en={sceneTitleEn(scene)} /></p>
        <div className="statGrid">
          <div className="stat"><b>{rewind.minutes}</b><span>{t("min de charla", "min talking")}</span></div>
          <div className="stat"><b>{fixes.length}</b><span>{t(fixes.length === 1 ? "corrección" : "correcciones", fixes.length === 1 ? "fix" : "fixes")}</span></div>
          <div className="stat"><b>{rewind.newWords}</b><span>{t("palabras nuevas", "new words")}</span></div>
        </div>

        {fixes.length === 0 ? (
          <div className="doneNote">{t("Esta vez no hubo nada que corregir. Muy bien.", "Nothing to fix this time. Nicely done.")}</div>
        ) : (
          <>
            <h2 className="sectionHead">{t("Tus frases, más naturales", "Your sentences, smoothed out")}</h2>
            {fixes.map((f, i) => {
              const d = diffWords(f.you_said, f.better);
              return (
                <article key={i} className={"fixCard" + (f.keep ? "" : " off")}>
                  <div className="fixLine">
                    <div className="fixText">
                      <span className="cardLabel">{t("Dijiste", "You said")}</span>
                      <span>{d.said.map((x, k) => <React.Fragment key={k}>{k > 0 && " "}{x.changed ? <s className="fixOld">{x.w}</s> : x.w}</React.Fragment>)}</span>
                    </div>
                    <button className="playBtn" onClick={() => speak(f.you_said, 0.95, { own: true })} aria-label={t("Escuchar lo que dijiste", "Play what you said")}><Icon name="play" size={16} /></button>
                  </div>
                  <div className="fixLine">
                    <div className="fixText">
                      <span className="cardLabel">{t("Más natural", "More natural")}</span>
                      <span>{d.better.map((x, k) => <React.Fragment key={k}>{k > 0 && " "}{x.changed ? <mark className="fixNew">{x.w}</mark> : x.w}</React.Fragment>)}</span>
                    </div>
                    <button className="playBtn strong" onClick={() => speakAs(rewind.voice, f.better)} aria-label={t("Escuchar la versión natural", "Play the natural version")}><Icon name="play" size={16} /></button>
                  </div>
                  {f.why && <p className="fixWhy">{plain(f.why)}</p>}
                  <label className="fixKeep">
                    <span>{t("Guardar como tarjeta", "Keep as a review card")}</span>
                    <input type="checkbox" role="switch" checked={f.keep} onChange={() => toggle(i)} />
                  </label>
                </article>
              );
            })}
          </>
        )}
      </div>
      <div className="rewindFoot">
        <button className="cta" onClick={() => onSave(false)}>
          {kept ? t(`Guardar ${kept} tarjeta${kept === 1 ? "" : "s"}`, `Save ${kept} review card${kept === 1 ? "" : "s"}`) : t("Listo", "Done")}
        </button>
        {kept > 0 && <button className="linkRow" onClick={() => onSave(true)}>{t("Practicarlas ahora", "Practise them now")}</button>}
        <button className="linkRow quiet" onClick={onReflect}>{t("Ver la reflexión", "See the reflection")}</button>
      </div>
    </div>
  );
}

/* Full-screen moment when a can-do statement completes — their own words, played back */
function CanDoUnlocked({ item, onClose }) {
  const t = useT();
  const share = async () => {
    // The statements are written to the learner ("Presentarte", "…cómo te sientes"), so the share
    // text quotes them rather than rephrasing into first person.
    try { await navigator.share({ text: `Nuevo logro en Charla: ${item.es} (${item.en})` }); } catch {}
  };
  return (
    <div className="unlocked" role="dialog" aria-modal="true" aria-label={t("Nuevo logro", "New can-do")}>
      <div className="unlockedHead"><button className="iconBtn light" onClick={onClose} aria-label={t("Cerrar", "Close")}><Icon name="close" /></button></div>
      <div className="unlockedBody">
        <svg className="unlockedMark" viewBox="0 0 100 100" aria-hidden="true">
          <path fill={T.rosa} d={BUBBLE_PATH} />
          <path d="M36 46l11 11 20-22" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="unlockedKicker">{t("Nuevo logro", "New can-do")}</span>
        <h1 className="unlockedTitle">{t(`Ya puedes ${lowerFirst(item.es)}.`, `You can ${lowerFirst(item.en)} in Spanish.`)}</h1>
        {item.quote && (
          <div className="unlockedQuote">
            <span>{t(`Así lo dijiste · ${item.scene}`, `Here's you doing it · ${item.scene}`)}</span>
            <p>“{item.quote}” <button className="playBtn light" onClick={() => speak(item.quote, 0.95, { own: true })} aria-label={t("Escuchar", "Play")}><Icon name="play" size={14} /></button></p>
          </div>
        )}
        <span className="unlockedArea">{t(`${item.area.es} · ahora ${item.areaDone} de ${item.area.items.length}`, `${item.area.en} · now ${item.areaDone} of ${item.area.items.length}`)}</span>
      </div>
      <div className="unlockedFoot">
        <button className="cta" onClick={onClose}>{t("Seguir", "Keep going")}</button>
        {typeof navigator !== "undefined" && navigator.share && <button className="ghostBtn" onClick={share}><Icon name="share" size={18} /> {t("Compartir", "Share")}</button>}
      </div>
    </div>
  );
}

/* ==================== MENSAJES — contacts who text you first ==================== */
function Mensajes({ contacts, threads, updateThread, getThread, recordActivity, words, updateWords, gloss, mergeGloss, lookupWord }) {
  const t = useT();
  const [openId, setOpenId] = useState(null);
  const tip = useTip("mensajes");
  const locale = t("es-ES", "en-US");

  if (openId) {
    const contact = contacts.find(c => c.id === openId);
    return (
      <ContactThread contact={contact} thread={threads[openId]} updateThread={updateThread} getThread={getThread}
                     recordActivity={recordActivity} onBack={() => setOpenId(null)} words={words} updateWords={updateWords}
                     gloss={gloss} mergeGloss={mergeGloss} lookupWord={lookupWord} />
    );
  }

  // Unread first, then the most recent conversation, like any messaging app.
  const lastOf = c => threads[c.id]?.msgs?.[threads[c.id].msgs.length - 1];
  const sorted = [...contacts].sort((a, b) =>
    (!!threads[b.id]?.unread - !!threads[a.id]?.unread) || ((lastOf(b)?.ts || 0) - (lastOf(a)?.ts || 0)));
  const when = ts => (dayKey(ts) === dayKey(Date.now())
    ? new Date(ts).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
    : new Date(ts).toLocaleDateString(locale, { day: "numeric", month: "short" }));

  return (
    <div className="pad">
      <ScreenTitle es="Mensajes" en="Messages" />
      <p className="sub">{t("Tus contactos te escriben como en la vida real. Contesta cuando quieras, en español.", "Your contacts text you like in real life. Reply whenever you like, in Spanish.")}</p>
      <Tip tip={tip} points={[
        "Every few days someone texts you first. You'll see a pink dot.",
        "Reply by talking or typing. Nobody's in a hurry here.",
        "Tap new words to save them to your deck.",
      ]} />
      <div className="contactList">
        {sorted.map(c => {
          const th = threads[c.id];
          const last = lastOf(c);
          return (
            <button key={c.id} className="contactRow" onClick={() => { setOpenId(c.id); if (th?.unread) updateThread(c.id, cur => ({ ...cur, unread: false })); }}>
              <Avatar name={c.name} />
              <span className="contactBody">
                <span className="contactName">{c.name}{th?.unread && <span className="unreadDot" />}</span>
                <span className="contactPreview dim">
                  {last ? (last.role === "me" ? t("Tú: ", "You: ") : "") + last.es : t("Sin mensajes todavía", "No messages yet")}
                </span>
              </span>
              {last?.ts && <span className="contactTime dim">{when(last.ts)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ContactThread({ contact, thread, updateThread, getThread, recordActivity, onBack, words, updateWords, gloss, mergeGloss, lookupWord }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [typeMode, setTypeMode] = useState(false);
  const [input, setInput] = useState("");
  const [lifelineOpen, setLifelineOpen] = useState(false);
  const [pinned, setPinned] = useState(null);
  const endRef = useRef(null);
  const msgs = thread?.msgs || [];
  const persona = { who: `${contact.name}, ${contact.aboutEn}`, title: "Texting with a friend" };

  useEffect(() => {
    setCharacterVoice(voiceFor(contact));
    return () => setCharacterVoice(null);
  }, [contact]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length, busy]);

  // A text that arrives while the thread is open is read, not a pink dot for later.
  useEffect(() => { if (thread?.unread) updateThread(contact.id, cur => ({ ...cur, unread: false })); }, [thread?.unread]); // eslint-disable-line

  const reply = (raw) => {
    const p = parseReply(raw);
    updateThread(contact.id, cur => ({
      ...cur,
      msgs: [...dropTrailingError(cur.msgs), { role: "them", es: p.reply, hint: p.hint, correction: p.correction, new_words: p.new_words || [], gloss: normGloss(p.gloss), ts: Date.now() }],
      apiHistory: [...cur.apiHistory, { role: "assistant", content: raw }],
    }));
    mergeGloss(p.gloss);
  };
  const failed = (err) => updateThread(contact.id, cur => ({
    ...cur, msgs: [...dropTrailingError(cur.msgs), { role: "them", es: errorText(err, t), error: true, ts: Date.now() }],
  }));

  const send = useCallback(async (text) => {
    text = text.trim();
    if (!text) return;
    setPinned(null);
    // A thread can be opened before the contact has ever texted first (apiHistory still empty) —
    // fold the persona instructions into this first turn so the model replies in character.
    const withLearner = (history) => appendUser(history, history.length === 0
      ? buildContactSystemPrompt(contact) + `\n\n(The learner just texted you first. Their message: "${text}")`
      : text);
    const hist = withLearner(getThread(contact.id).apiHistory || []);
    updateThread(contact.id, cur => ({
      ...cur, msgs: [...dropTrailingError(cur.msgs), { role: "me", es: text, ts: Date.now() }],
      apiHistory: withLearner(cur.apiHistory || []), awaitingReply: false,
    }));
    recordActivity("texts");
    setBusy(true);
    try { reply(await askAI(hist, { json: true })); } catch (err) { failed(err); }
    setBusy(false);
  }, [contact, getThread, updateThread, recordActivity, mergeGloss, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const retryLast = useCallback(async () => {
    setBusy(true);
    try { reply(await askAI(getThread(contact.id).apiHistory, { json: true })); } catch (err) { failed(err); }
    setBusy(false);
  }, [contact, getThread, mergeGloss, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const mic = useMic(send);

  const saveWord = (w) => {
    updateWords(ws => (ws.some(x => strip(x.es) === strip(w.es)) ? ws : [...ws, { ...w, due: Date.now(), interval: 0, reps: 0, added: Date.now() }]));
  };

  const openLifeline = () => { hush(); if (mic.listening) mic.cancel(); setLifelineOpen(true); };
  const lifelineTurn = (es) => {
    setLifelineOpen(false);
    setPinned(es);
    if (mic.supported && !typeMode) mic.start();
    else setTypeMode(true);
  };
  const lifelineBtn = (small) => (
    <button className={"lifelineBtn" + (small ? " small" : "")} onClick={openLifeline} disabled={busy}
            aria-label={t("¿Cómo se dice? Dilo en inglés", "How do you say it? Say it in English")}>?</button>
  );

  return (
    <div className="chatWrap">
      <div className="chatHead">
        <button className="iconBtn" onClick={onBack} aria-label={t("Volver a Mensajes", "Back to Messages")}><Icon name="back" size={24} /></button>
        <Avatar name={contact.name} size={38} />
        <div className="chatHeadText">
          <div className="chatTitle">{contact.name}</div>
          <div className="chatGoal">{t(contact.about, contact.aboutEn)}</div>
        </div>
      </div>

      <div className="msgs">
        {msgs.length === 0 && !busy && (
          <p className="emptyThread">{t(`${contact.name} todavía no te ha escrito. Puedes saludar tú primero.`, `${contact.name} hasn't written yet. You can say hi first.`)}</p>
        )}
        {msgs.map((m, i) => (
          <ChatMessage key={m.ts ? `${m.ts}-${i}` : i} m={m} mine={m.role === "me"} isLast={i === msgs.length - 1} busy={busy} onRetry={retryLast}
                       words={words} saveWord={saveWord} gloss={gloss} lookupWord={lookupWord} />
        ))}
        {busy && <div className="row ai"><div className="bubble ai typing">● ● ●</div></div>}
        <div ref={endRef} />
      </div>

      {lifelineOpen && (
        <LifelineSheet persona={persona} partnerLabel={contact.name} sceneLabel={contact.name} voice={voiceFor(contact)}
                       partner={[...msgs].reverse().find(m => m.role === "them" && !m.error)?.es || ""}
                       words={words} updateWords={updateWords} mergeGloss={mergeGloss} gloss={gloss} lookupWord={lookupWord}
                       onClose={() => setLifelineOpen(false)} onTurn={lifelineTurn} />
      )}

      <div className="talkBar">
        {pinned && <PinCard text={pinned} onDismiss={() => setPinned(null)} />}
        {typeMode || !mic.supported ? (
          <div className="typeRow">
            {lifelineBtn(true)}
            <input value={input} onChange={e => setInput(e.target.value)}
                   onKeyDown={e => { if (e.key === "Enter" && input.trim() && !busy) { send(input); setInput(""); } }}
                   placeholder={t("Escribe en español…", "Write in Spanish…")} aria-label={t("Escribe en español", "Write in Spanish")} autoFocus />
            <button className="sendBtn" disabled={busy || !input.trim()} onClick={() => { send(input); setInput(""); }} aria-label={t("Enviar", "Send")}><Icon name="send" /></button>
            {mic.supported && <button className="iconBtn" onClick={() => setTypeMode(false)} aria-label={t("Hablar", "Talk")}><Icon name="mic" size={22} /></button>}
          </div>
        ) : (
          <>
            <div className={"liveText" + (mic.error ? " err" : "")}>
              {mic.error ? mic.error : mic.listening ? (mic.interim || t("Te escucho…", "I'm listening…")) : busy ? t("Pensando…", "Thinking…") : t("Toca y habla", "Tap and talk")}
            </div>
            <div className="talkRow">
              <span className="toolCol">
                <button className="sideTool" onClick={() => setTypeMode(true)} aria-label={t("Escribir", "Type instead")}><Icon name="keyboard" size={22} /></button>
                <span>{t("Escribir", "Type")}</span>
              </span>
              <button className={"talkBtn " + (mic.listening ? "live" : "")} disabled={busy}
                      aria-label={mic.listening ? t("Terminar de hablar", "Done talking") : t("Hablar", "Talk")}
                      onClick={() => (mic.listening ? mic.stop() : mic.start())}>
                <Icon name={mic.listening ? "stop" : "mic"} size={32} stroke={2} />
              </button>
              <span className="toolCol">
                {lifelineBtn(false)}
                <span className="lifeLabel">{t("¿Cómo se dice?", "How do you say it?")}</span>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ==================== REPASAR — spaced, retrieval-first, multi-cue ==================== */
async function shrinkImage(file, max = 1400) {
  const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85).split(",")[1];
}

function Repasar({ words, updateWords, recordActivity, gloss, lookupWord, startWith, onStarted }) {
  const t = useT();
  const [queue, setQueue] = useState(null);
  const [idx, setIdx] = useState(0);
  const [attempt, setAttempt] = useState("");
  const [typing, setTyping] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [showPista, setShowPista] = useState(false);
  const [done, setDone] = useState(0);
  const [mnBusy, setMnBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [add, setAdd] = useState({ es: "", en: "", example: "" });
  const [scan, setScan] = useState(null);
  const [lastDeleted, setLastDeleted] = useState(null);
  const [lastGrade, setLastGrade] = useState(null);
  const [showDeck, setShowDeck] = useState(false);
  const [deckQuery, setDeckQuery] = useState("");
  const [editing, setEditing] = useState(null); // { orig, es, en, example, error }
  const tip = useTip("repasar");
  const fileRef = useRef(null);
  const deleteTimerRef = useRef(null);
  const gradeTimerRef = useRef(null);

  useEffect(() => () => { clearTimeout(deleteTimerRef.current); clearTimeout(gradeTimerRef.current); }, []);

  const due = words.filter(w => w.due <= Date.now());
  const dueMistakes = due.filter(w => w.kind === "mistake").length;
  const current = queue ? words.find(w => w.es === queue[idx]) : null;
  // Mistake cards always ask for the natural version out loud — that's the whole point of them.
  const mode = current ? (current.kind !== "mistake" && current.reps % 2 === 1 ? "listen" : "produce") : "produce";

  const onSpoken = useCallback((text) => setAttempt(text), []);
  const esMic = useMic(onSpoken);
  const enMic = useMic(onSpoken, "en-US"); // listen cards: say what it means, in English
  const mic = mode === "produce" ? esMic : enMic;

  // A card from a chat speaks in that character's voice, the answer as well as the moment.
  const say = (text, rate) => (current?.voice ? speakAs(current.voice, text, rate) : speak(text, rate));

  useEffect(() => () => { hush(); }, []);
  useEffect(() => { if (current && mode === "listen" && !revealed) say(current.es, 0.9); }, [idx, queue]); // eslint-disable-line

  const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const resetCard = () => { setAttempt(""); setRevealed(false); setShowPista(false); setTyping(false); };
  const startSession = (list) => { setQueue(shuffle(list).map(w => w.es)); setIdx(0); resetCard(); setDone(0); setLastGrade(null); };

  // "Practise them now" from the rewind lands here with the cards it just saved.
  useEffect(() => {
    if (!startWith) return;
    const list = words.filter(w => startWith.some(es => strip(es) === strip(w.es)));
    if (list.length) startSession(list);
    onStarted?.();
  }, [startWith]); // eslint-disable-line react-hooks/exhaustive-deps

  const reveal = () => { setRevealed(true); if (current) say(current.es, 0.85); };

  // A missed card comes round again at the end of this session (up to twice), not just in 10 min.
  const willRequeue = current && queue.filter(es => es === current.es).length < 3;

  const grade = (good) => {
    hush();
    const prevWord = current, prevQueue = queue, prevIdx = idx, prevDone = done;
    const now = Date.now();
    updateWords(ws => ws.map(w => (w.es === prevWord.es ? schedule(w, good, now) : w)));
    recordActivity("reviews");
    setDone(d => d + 1);
    setLastGrade({ prevWord, prevQueue, prevIdx, prevDone });
    clearTimeout(gradeTimerRef.current);
    gradeTimerRef.current = setTimeout(() => setLastGrade(null), 6000);
    const nextQueue = !good && willRequeue ? [...queue, current.es] : queue;
    if (idx + 1 >= nextQueue.length) setQueue(null);
    else { setQueue(nextQueue); setIdx(idx + 1); resetCard(); }
  };

  const undoGrade = () => {
    if (!lastGrade) return;
    const { prevWord } = lastGrade;
    updateWords(ws => ws.map(w => (w.es === prevWord.es ? prevWord : w)));
    setQueue(lastGrade.prevQueue); setIdx(lastGrade.prevIdx); setDone(lastGrade.prevDone);
    setAttempt(""); setRevealed(true); setLastGrade(null);
  };

  const removeWord = (es) => {
    const w = words.find(x => x.es === es);
    updateWords(ws => ws.filter(x => x.es !== es));
    if (w) {
      setLastDeleted(w);
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setLastDeleted(null), 5000);
    }
  };

  const undoDelete = () => {
    if (!lastDeleted) return;
    const w = lastDeleted;
    updateWords(ws => (ws.some(x => strip(x.es) === strip(w.es)) ? ws : [...ws, w]));
    setLastDeleted(null);
  };

  const addCards = (list, extra = {}) => {
    const now = Date.now();
    updateWords(ws => {
      const fresh = list.filter(w => !ws.some(x => strip(x.es) === strip(w.es)));
      return fresh.length ? [...ws, ...fresh.map(w => ({ ...w, due: now, interval: 0, reps: 0, added: now, ...extra }))] : ws;
    });
  };

  const addManual = () => {
    const es = add.es.trim(), en = add.en.trim();
    if (!es || !en) return;
    addCards([{ es, en, example: add.example.trim() }], { manual: true });
    setAdd({ es: "", en: "", example: "" });
  };

  const saveEdit = () => {
    const es = editing.es.trim(), en = editing.en.trim();
    if (!es || !en) return;
    if (words.some(w => w.es !== editing.orig && strip(w.es) === strip(es))) {
      return setEditing(e => ({ ...e, error: true }));
    }
    const { orig } = editing;
    updateWords(ws => ws.map(w => (w.es === orig ? { ...w, es, en, example: editing.example.trim() } : w)));
    setEditing(null);
  };

  const getMnemonic = async () => {
    if (!current || mnBusy) return;
    const card = current;
    setMnBusy(true);
    try {
      const raw = await askAI([{ role: "user", content: `Create a memorable mnemonic for an English speaker learning the Spanish word "${card.es}" (meaning: "${card.en}"). Use the keyword method: find an English word or phrase that SOUNDS like the Spanish, then link it to the meaning with one vivid, slightly absurd image. Max 2 short sentences, plain text, no preamble, no em dashes.` }]);
      const mnemonic = plain(raw.trim().slice(0, 300));
      updateWords(ws => ws.map(w => (w.es === card.es ? { ...w, mnemonic } : w)));
    } catch {}
    setMnBusy(false);
  };

  const onPickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setScan({ busy: true });
    try {
      const b64 = await shrinkImage(file);
      const raw = await askAI([{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
          { type: "text", text: `This photo contains Spanish text (a sign, menu, message, page…). 1) Transcribe the Spanish exactly, fixing only obvious OCR errors. 2) Translate it to natural English. 3) Extract 3–8 useful words or short phrases for a BEGINNER, each with an English meaning and a short Spanish example. ${HOUSE_STYLE}
Respond ONLY with JSON, no fences:\n{"text":"","translation":"","words":[{"es":"","en":"","example":""}]}` },
        ],
      }], { json: true });
      const p = parseAIJson(raw);
      if (!p?.text) throw new Error("Unreadable scan");
      // Suggestions only: the learner picks what goes into the deck.
      const found = (Array.isArray(p.words) ? p.words : []).filter(w => typeof w?.es === "string" && w.es.trim() && typeof w.en === "string" && w.en.trim())
        .map(w => ({ es: w.es.trim(), en: w.en.trim(), example: typeof w.example === "string" ? w.example.trim() : "" }));
      setScan({ text: p.text, translation: p.translation, words: found });
    } catch { setScan({ error: true }); }
  };

  /* ---------- Session card ---------- */
  if (queue && current) {
    const match = attempt && (mode === "produce" ? strip(attempt).includes(strip(current.es)) : strip(current.en).split(/[\/,;]/).some(part => part.trim() && strip(attempt).includes(part.trim())));
    const blanked = current.example ? current.example.replace(new RegExp(current.es.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "＿＿＿") : null;
    const nextGap = nextReviewInterval(current);
    // Older mistake cards stored the reason when the model gave no English; the learner's own line is a better cue.
    const mistakeCue = current.kind === "mistake" && (!current.en || current.en === current.why) ? current.you_said : null;
    return (
      <div className="pad">
        <div className="progress">
          <span>{idx + 1} / {queue.length}</span>
          <span>{mode === "produce" ? t("Dilo en español", "Say it in Spanish") : t("Escucha y di qué significa", "Listen and say what it means")}</span>
        </div>
        <div className="progressBar" aria-hidden="true"><span style={{ width: `${(idx / queue.length) * 100}%` }} /></div>
        <div className="card">
          {mode === "produce" ? (
            <>
              {current.context && (
                <div className="ctxRow">
                  <span className="cardKind">{current.kind === "mistake" ? t("De tu charla", "From your chat") : t("De un ¿Cómo se dice?", "From a How do you say it?")} · {current.scene}</span>
                  <div className="ctxLine">
                    <button className="playBtn" onClick={() => say(current.context)} aria-label={t("Volver a escuchar el momento", "Replay the moment")}><Icon name="play" size={16} /></button>
                    <div>
                      <span className="cardLabel">{current.partner ? t(`${current.partner} te dijo`, `${current.partner} said`) : t("Te dijeron", "They said")}</span>
                      <TapText text={current.context} gloss={gloss} lookup={lookupWord} />
                    </div>
                  </div>
                </div>
              )}
              <div className="cardLabel">{current.kind === "mistake" ? (mistakeCue ? t("Dilo mejor", "Say it better") : t("Dilo de forma natural", "Say it the natural way")) : t("¿Cómo se dice en español?", "How do you say it in Spanish?")}</div>
              <div className="cardEn">{current.kind === "mistake" ? `“${mistakeCue || current.en}”` : current.en}</div>
              {current.you_said && !mistakeCue && <div className="cardEx">{t("La última vez te salió así:", "Last time it came out as:")} <s>{current.you_said}</s></div>}
              {blanked && <div className="cardEx">“<TapText text={blanked} gloss={gloss} lookup={lookupWord} />”</div>}
            </>
          ) : (
            <>
              <div className="cardLabel">{t("Escucha y di qué significa", "Listen, then say what it means")}</div>
              <button className="bigSpk" onClick={() => say(current.es, 0.9)} aria-label={t("Escuchar otra vez", "Play again")}><Icon name="speaker" size={38} stroke={1.8} /></button>
              <button className="tool center" onClick={() => say(current.es, 0.6)}><Icon name="slow" size={16} /> {t("Más lento", "Slower")}</button>
            </>
          )}

          {!revealed ? (
            <>
              {mic.supported && !typing ? (
                <div className="talkRow center">
                  <button className={"talkBtn small " + (mic.listening ? "live" : "")} onClick={() => (mic.listening ? mic.stop() : mic.start())}
                          aria-label={mic.listening ? t("Terminar de hablar", "Done talking") : mode === "produce" ? t("Decirlo en voz alta", "Say it out loud") : t("Decir qué significa", "Say what it means")}>
                    <Icon name={mic.listening ? "stop" : "mic"} size={28} stroke={2} />
                  </button>
                  <button className="sideTool" onClick={() => setTyping(true)} aria-label={t("Escribir", "Type instead")}><Icon name="keyboard" size={22} /></button>
                </div>
              ) : (
                <input className="attempt" value={attempt} onChange={e => setAttempt(e.target.value)}
                       onKeyDown={e => e.key === "Enter" && reveal()}
                       aria-label={mode === "produce" ? t("Tu respuesta", "Your answer") : t("Qué significa", "What it means")}
                       placeholder={mode === "produce" ? t("Escribe tu respuesta…", "Type your answer…") : t("Escribe qué significa, en inglés…", "Type the meaning, in English…")} autoFocus />
              )}
              <div className={"liveText tall" + (mic.error ? " err" : "")}>
                {mic.error ? mic.error : mic.listening ? (mic.interim || (mode === "produce" ? t("Te escucho…", "I'm listening…") : t("Te escucho… en inglés", "Listening… in English")))
                  : attempt && !typing ? t(`Dijiste: “${attempt}”`, `You said: “${attempt}”`)
                  : mic.supported && !typing ? (mode === "produce" ? t("Dilo en voz alta y luego mira la respuesta", "Say it out loud, then check the answer") : t("Di en inglés qué significa y luego mira la respuesta", "Say what it means in English, then check the answer")) : ""}
              </div>
              {showPista && current.why && mode === "produce" && <div className="pistaWhy">{plain(current.why)}</div>}
              {showPista && <div className="pistaMask">{mode === "produce" ? maskHint(current.es) : current.es}</div>}
              <div className="revealRow">
                {!showPista && <button className="pistaBtn" onClick={() => setShowPista(true)}><Icon name="bulb" size={18} /> {t("Pista", "Hint")}</button>}
                <button className="cta inRow" onClick={reveal}>{t("Ver respuesta", "Show answer")}</button>
              </div>
            </>
          ) : (
            <>
              <div className="veilAnswer">
                <button className="answerEs" onClick={() => say(current.es, 0.85)}>{current.es} <Icon name="speaker" size={20} /></button>
                <div className="answerEn">{current.en}</div>
                {current.why && current.why !== current.en && <div className="answerWhy">{plain(current.why)}</div>}
                {current.example && <div className="answerEx">“<TapText text={current.example} gloss={gloss} lookup={lookupWord} />” <SpeakBtn text={current.example} rate={0.8} /></div>}
                {attempt && (
                  <div className={"attemptCheck " + (match ? "yes" : "")}>
                    {match ? <><Icon name="check" size={16} stroke={2.4} /> {t("Eso es lo que dijiste", "That's what you said")}</> : t(`Dijiste: “${attempt}”`, `You said: “${attempt}”`)}
                  </div>
                )}
                {current.mnemonic
                  ? <div className="mnemo"><Icon name="brain" size={16} /> {current.mnemonic}</div>
                  : <button className="tool" onClick={getMnemonic} disabled={mnBusy}><Icon name="brain" size={15} /> {mnBusy ? "…" : t("Truco para recordar", "Memory trick")}</button>}
              </div>
              <div className="gradeRow">
                <button className="gradeBtn no" onClick={() => grade(false)}>{t("Otra vez", "Again")}<span>{willRequeue ? t("vuelve en esta ronda", "again this round") : t("vuelve en 10 min", "back in 10 min")}</span></button>
                <button className="gradeBtn yes" onClick={() => grade(true)}>
                  {t("Me la sabía", "I knew it")}<span>{t(nextGap === 1 ? "vuelve mañana" : `vuelve en ${nextGap} días`, nextGap === 1 ? "back tomorrow" : `back in ${nextGap} days`)}</span>
                </button>
              </div>
            </>
          )}
        </div>
        <div className="sessionFoot">
          {lastGrade && <button className="undoRow" onClick={undoGrade}><Icon name="retry" size={15} /> {t("Deshacer", "Undo")}</button>}
          <button className="undoRow" onClick={() => setQueue(null)}>{t("Parar por hoy", "Stop for now")}</button>
        </div>
      </div>
    );
  }

  /* ---------- Menu ---------- */
  const dueIn = (w) => {
    const d = dueWhen(w.due);
    return d.kind === "now" ? t("hoy", "today")
      : d.kind === "minutes" ? t(`en ${d.n} min`, `in ${d.n} min`)
      : d.kind === "hours" ? t(`en ${d.n} h`, `in ${d.n} h`)
      : d.kind === "tomorrow" ? t("mañana", "tomorrow")
      : t(`en ${d.n} días`, `in ${d.n} days`);
  };
  const q = strip(deckQuery);
  const deckShown = [...words].sort((a, b) => a.due - b.due).filter(w => !q || strip(w.es).includes(q) || strip(w.en || "").includes(q));
  const scanFresh = scan?.words?.filter(w => !words.some(x => strip(x.es) === strip(w.es))) || [];
  return (
    <div className="pad">
      <ScreenTitle es="Repaso hablado" en="Spoken review" />
      <p className="sub">
        {words.length === 0 ? t("Guarda palabras de tus charlas, escanea una foto o añade las tuyas. Charla te las trae de vuelta justo antes de que se te olviden.", "Save words from your chats, scan a photo, or add your own. Charla brings them back right before you'd forget them.")
          : due.length > 0 ? t(`Tienes ${due.length} tarjeta${due.length === 1 ? "" : "s"} para hoy. Dilas en voz alta antes de mirar.`, `${due.length} card${due.length === 1 ? "" : "s"} for today. Say them out loud before you peek.`)
            + (dueMistakes ? " " + t(`${dueMistakes} ${dueMistakes === 1 ? "viene" : "vienen"} de tus propias charlas.`, `${dueMistakes} come from your own chats.`) : "")
          : t("Hoy no te toca nada. Si quieres, puedes repasar toda la baraja; eso no adelanta las fechas.", "Nothing due today. You can still run through the whole deck; it won't push the dates out.")}
      </p>
      <Tip tip={tip} points={[
        "Try saying it out loud first. Then check the answer.",
        "If you knew it, it comes back later. If not, you'll see it again before the session ends.",
        "The pink cards come from your own chats.",
      ]} />
      {done > 0 && <div className="doneNote">{t(`Hecho: ${done} repasada${done === 1 ? "" : "s"}. Las siguientes ya están programadas.`, `Done: ${done} reviewed. The next ones are scheduled.`)}</div>}
      {lastGrade && (
        <div className="undoToast">
          <span>{t(`Calificaste: ${lastGrade.prevWord.es}`, `Graded: ${lastGrade.prevWord.es}`)}</span>
          <button onClick={undoGrade}>{t("Deshacer", "Undo")}</button>
        </div>
      )}
      {lastDeleted && (
        <div className="undoToast">
          <span>{t(`Borrada: ${lastDeleted.es}`, `Deleted: ${lastDeleted.es}`)}</span>
          <button onClick={undoDelete}>{t("Deshacer", "Undo")}</button>
        </div>
      )}
      {words.length > 0 && (due.length > 0
        ? <button className="cta" onClick={() => startSession(due)}>{t("Empezar repaso", "Start review")}</button>
        : <button className="cta" onClick={() => startSession(words)}>{t("Repasar todas", "Review them all")}</button>)}

      <div className="toolCards">
        <button className="toolCard" onClick={() => fileRef.current?.click()}>
          <span className="toolIcon"><Icon name="camera" size={22} /></span>
          <span><b>{t("Escanear texto", "Scan text")}</b><span className="dim">{t("Haz una foto a un menú, un cartel o un mensaje. Charla lo lee, lo traduce y te propone palabras útiles.", "Photograph a menu, a sign or a message. Charla reads it, translates it and suggests useful words.")}</span></span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPickImage} />
        <button className="toolCard" onClick={() => setShowAdd(s => !s)} aria-expanded={showAdd}>
          <span className="toolIcon"><Icon name="plus" size={22} /></span>
          <span><b>{t("Añadir palabra", "Add a word")}</b><span className="dim">{t("Una palabra o frase tuya, a tu baraja.", "Your own word or phrase, into your deck.")}</span></span>
        </button>
      </div>

      {showAdd && (
        <div className="addForm">
          <input value={add.es} onChange={e => setAdd({ ...add, es: e.target.value })} aria-label={t("En español", "In Spanish")} placeholder={t("Palabra o frase en español", "Spanish word or phrase")} />
          <input value={add.en} onChange={e => setAdd({ ...add, en: e.target.value })} aria-label={t("Significado", "Meaning")} placeholder={t("Qué significa, en inglés", "What it means, in English")} />
          <input value={add.example} onChange={e => setAdd({ ...add, example: e.target.value })} onKeyDown={e => e.key === "Enter" && addManual()} aria-label={t("Ejemplo", "Example")} placeholder={t("Un ejemplo (si quieres)", "An example (optional)")} />
          {add.es.trim() && words.some(w => strip(w.es) === strip(add.es)) && <div className="creatorError">{t("Ya está en tu baraja.", "Already in your deck.")}</div>}
          <button className="cta small" onClick={addManual} disabled={!add.es.trim() || !add.en.trim() || words.some(w => strip(w.es) === strip(add.es))}>{t("Guardar en la baraja", "Save to deck")}</button>
        </div>
      )}

      {scan && (
        <div className="scanCard">
          <button className="iconBtn small cardClose" onClick={() => setScan(null)} aria-label={t("Cerrar", "Close")}><Icon name="close" size={16} /></button>
          {scan.busy ? <div className="dim">{t("Leyendo la foto…", "Reading the photo…")}</div>
            : scan.error ? (
              <div>
                <div className="dim">{t("No pude leer esa foto. Prueba con una más cerca y más nítida.", "Couldn't read that photo. Try one that's closer and sharper.")}</div>
                <button className="tool" onClick={() => fileRef.current?.click()}><Icon name="retry" size={15} /> {t("Escanear otra vez", "Scan again")}</button>
              </div>
            )
            : (
              <>
                <div className="cardLabel">{t("Texto", "Text")}</div>
                <div className="scanText"><TapText text={scan.text} gloss={gloss} lookup={lookupWord} /> <SpeakBtn text={scan.text} rate={0.85} own /></div>
                <div className="cardLabel">{t("Traducción", "Translation")}</div>
                <div className="scanTrans">{plain(scan.translation)}</div>
                {scan.words.length > 0 && <div className="cardLabel">{t("Palabras útiles", "Useful words")}</div>}
                {scan.words.map((w, i) => {
                  const inDeck = words.find(x => strip(x.es) === strip(w.es));
                  return (
                    <div key={i} className="deckRow">
                      <div><b>{w.es}</b> <span className="dim">· {w.en}</span></div>
                      {inDeck
                        ? <button className="miniBtn" onClick={() => removeWord(inDeck.es)}>{t("Quitar", "Remove")}</button>
                        : <button className="miniBtn add" onClick={() => addCards([w], { scanned: true })} aria-label={t(`Guardar ${w.es}`, `Save ${w.es}`)}><Icon name="plus" size={14} stroke={2.4} /></button>}
                    </div>
                  );
                })}
                {scanFresh.length > 1 && <button className="cta small" onClick={() => addCards(scanFresh, { scanned: true })}>{t(`Guardar las ${scanFresh.length}`, `Save all ${scanFresh.length}`)}</button>}
                <button className="tool" onClick={() => fileRef.current?.click()}><Icon name="retry" size={15} /> {t("Escanear otra vez", "Scan again")}</button>
              </>
            )}
        </div>
      )}

      {words.length > 0 && (
        <section className="deck">
          <button className="deckToggle" onClick={() => setShowDeck(s => !s)} aria-expanded={showDeck}>
            <span>{t("Tu baraja", "Your deck")}</span>
            <span className="dim">{t(`${words.length} tarjeta${words.length === 1 ? "" : "s"}`, `${words.length} card${words.length === 1 ? "" : "s"}`)}</span>
            <span className={"chev" + (showDeck ? " open" : "")} aria-hidden="true"><Icon name="back" size={18} /></span>
          </button>
          {showDeck && (
            <div className="deckList">
              {words.length > 8 && (
                <input className="deckSearch" value={deckQuery} onChange={e => setDeckQuery(e.target.value)}
                       aria-label={t("Buscar en tu baraja", "Search your deck")} placeholder={t("Buscar…", "Search…")} />
              )}
              {deckShown.length === 0 && <p className="sub">{t("Nada coincide.", "Nothing matches.")}</p>}
              {deckShown.map(w => editing?.orig === w.es ? (
                <div key={w.es} className="addForm">
                  <input value={editing.es} onChange={e => setEditing({ ...editing, es: e.target.value, error: false })} aria-label={t("En español", "In Spanish")} />
                  <input value={editing.en} onChange={e => setEditing({ ...editing, en: e.target.value })} aria-label={t("Significado", "Meaning")} />
                  <input value={editing.example} onChange={e => setEditing({ ...editing, example: e.target.value })} onKeyDown={e => e.key === "Enter" && saveEdit()}
                         aria-label={t("Ejemplo", "Example")} placeholder={t("Un ejemplo (si quieres)", "An example (optional)")} />
                  {editing.error && <div className="creatorError">{t("Ya tienes otra tarjeta con esa palabra.", "Another card already has that word.")}</div>}
                  <div className="editRow">
                    <button className="miniBtn" onClick={() => setEditing(null)}>{t("Cancelar", "Cancel")}</button>
                    <button className="cta small" onClick={saveEdit} disabled={!editing.es.trim() || !editing.en.trim()}>{t("Guardar", "Save")}</button>
                  </div>
                </div>
              ) : (
                <div key={w.es} className="deckRow">
                  <button className="deckWord" onClick={() => (w.voice ? speakAs(w.voice, w.es) : speak(w.es))}>
                    {w.kind && <span className={"kindTag " + w.kind}>{w.kind === "mistake" ? t("de tu charla", "from a chat") : t("¿Cómo se dice?", "how do you say it")}</span>}
                    <b>{w.es}</b> <span className="dim">· {w.en}</span>
                  </button>
                  <div className="deckRight">
                    <span className="dueTag">{dueIn(w)}</span>
                    <button className="iconBtn small" onClick={() => setEditing({ orig: w.es, es: w.es, en: w.en || "", example: w.example || "" })} aria-label={t(`Editar ${w.es}`, `Edit ${w.es}`)}><Icon name="edit" size={15} /></button>
                    <button className="iconBtn small" onClick={() => removeWord(w.es)} aria-label={t(`Borrar ${w.es}`, `Delete ${w.es}`)}><Icon name="close" size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <p className="howNote">
        {t("Cómo se te quedan: cada vez que aciertas, la tarjeta tarda más en volver. Primero intentas recordar y luego miras. Unas veces la dices y otras la escuchas, y el orden siempre cambia.",
           "How they stick: each time you get one right, it takes longer to come back. You try to recall before you look. Some days you say it, some days you hear it, and the order always changes.")}
      </p>
    </div>
  );
}

/* ==================== PROGRESO: minutes spoken, what you can do, and each day you showed up ==================== */
function WeekMinutes({ sessions }) {
  const t = useT();
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime();
  const prevMonday = new Date(monday - 7 * dayMs + 12 * 3600000).setHours(0, 0, 0, 0); // DST-safe
  const today = (now.getDay() + 6) % 7;
  const days = new Array(7).fill(0);
  let lastWeek = 0;
  for (const s of sessions) {
    if (s.ts >= monday) days[(new Date(s.ts).getDay() + 6) % 7] += s.minutes;
    else if (s.ts >= prevMonday) lastWeek += s.minutes;
  }
  const total = days.reduce((a, b) => a + b, 0);
  const peak = Math.max(...days, 10);
  const labels = t("LMXJVSD", "MTWTFSS");
  return (
    <section className="weekCard" aria-label={t("Minutos hablados esta semana", "Minutes spoken this week")}>
      <div className="weekTotal">
        <span className="weekKicker">{t("Hablado esta semana", "Spoken this week")}</span>
        <span className="weekNum">{total}<small>min</small></span>
        {lastWeek > 0 && total !== lastWeek && (
          <span className={"weekDelta" + (total < lastWeek ? " down" : "")}>
            {total > lastWeek ? t(`${total - lastWeek} más que la semana pasada`, `${total - lastWeek} more than last week`)
              : t(`${lastWeek - total} menos que la semana pasada`, `${lastWeek - total} fewer than last week`)}
          </span>
        )}
      </div>
      <div className="weekBars" aria-hidden="true">
        {days.map((m, i) => (
          <span key={i} className={"weekDay" + (i === today ? " today" : i > today ? " later" : "")}>
            <span className="weekBar" style={{ height: m ? Math.max(8, Math.round((m / peak) * 60)) : 4 }} />
            <span>{labels[i]}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

function CanDoMap({ cando, gloss, lookupWord, onPractice }) {
  const t = useT();
  // Opens on the area with the most going on; the others fold away until tapped.
  const busiest = [...CAN_DO].sort((a, b) => b.items.filter(i => cando[i.id]).length - a.items.filter(i => cando[i.id]).length)[0];
  const [openArea, setOpenArea] = useState(busiest.id);
  const [openItem, setOpenItem] = useState(null);
  return (
    <div className="canDo">
      {CAN_DO.map(area => {
        const done = area.items.filter(i => cando[i.id]?.status === "done").length;
        const open = openArea === area.id;
        return (
          <section key={area.id} className={"areaCard" + (open ? " open" : "")}>
            <button className="areaHead" aria-expanded={open} onClick={() => setOpenArea(open ? null : area.id)}>
              <span className="areaName"><TapPhrase es={area.es} en={area.en} /></span>
              <span className="areaCount">{t(`${done} de ${area.items.length}`, `${done} of ${area.items.length}`)}</span>
              <span className="areaBar"><span style={{ width: `${(done / area.items.length) * 100}%` }} /></span>
            </button>
            {open && area.items.map(item => {
              const entry = cando[item.id];
              const quote = entry?.evidence?.filter(e => e.quote).slice(-1)[0];
              const expanded = openItem === item.id && quote;
              const done = entry?.status === "done";
              const scene = SCENARIOS.find(sc => sc.id === item.scene);
              return (
                <div key={item.id} className={"canItem " + (entry?.status || "todo")}>
                  <div className="canRowWrap">
                    <button className="canRow" onClick={() => entry && quote && setOpenItem(expanded ? null : item.id)} aria-expanded={entry && quote ? !!expanded : undefined}>
                      <span className="canIcon" aria-label={done ? t("Hecho", "Done") : entry ? t("En camino", "In progress") : t("Sin empezar", "Not started")}>
                        {done ? <Icon name="check" size={15} stroke={3} /> : entry ? null : <Icon name="circle" size={18} stroke={2} />}
                      </span>
                      <span className="canText"><TapPhrase es={item.es} en={item.en} /></span>
                      {done && quote && <span className="canMeta">{t("Así lo dijiste", "Hear yourself")}</span>}
                    </button>
                    {/* Not done yet: one tap into the scene that practises it. */}
                    {!done && scene && (
                      <button className="miniBtn practiceBtn" onClick={() => onPractice(scene.id)} aria-label={t(`Practicar en ${scene.title}`, `Practise in ${scene.titleEn}`)}>
                        {entry ? t("Casi. Practicar", "Almost. Practise") : t("Practicar", "Practise")}
                      </button>
                    )}
                  </div>
                  {expanded && (
                    <div className="canQuote">
                      “<TapText text={quote.quote} gloss={gloss} lookup={lookupWord} />” <SpeakBtn text={quote.quote} own />
                      <div className="dim">{quote.scene} · {new Date(quote.ts).toLocaleDateString(t("es-ES", "en-US"), { day: "numeric", month: "short" })}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

// Groups everything that happened on a calendar day: minutes spoken, chats, words saved, cards
// reviewed and texts sent. Any of them counts as a day you showed up.
function buildDays(sessions, reflections, words, activity = {}) {
  const days = new Map();
  const day = ts => {
    const k = dayKey(ts);
    if (!days.has(k)) days.set(k, { key: k, ts: new Date(new Date(ts).setHours(12, 0, 0, 0)).getTime(), minutes: 0, chats: [], words: [], reviews: 0, texts: 0 });
    return days.get(k);
  };
  sessions.forEach(s => { day(s.ts).minutes += s.minutes; });
  reflections.forEach(r => day(r.id).chats.push(r));
  words.forEach(w => { if (w.added) day(w.added).words.push(w); });
  for (const [k, a] of Object.entries(activity)) {
    const [y, m, d] = k.split("-").map(Number);
    const entry = day(new Date(y, m - 1, d, 12).getTime());
    entry.reviews += a.reviews || 0;
    entry.texts += a.texts || 0;
  }
  return [...days.values()].sort((a, b) => b.ts - a.ts);
}

function Reflexion({ reflections, updateReflections, deleteChat, progress, words, gloss, lookupWord, openId, onOpened, onPractice }) {
  const t = useT();
  const tip = useTip("progreso");
  const [dayOpen, setDayOpen] = useState(null);
  const [open, setOpen] = useState(null);
  const [notes, setNotes] = useState({});
  const [showTranscript, setShowTranscript] = useState({});
  const [allDays, setAllDays] = useState(false);
  const locale = t("es-ES", "en-US");

  useEffect(() => {
    const n = {}; reflections.forEach(r => { n[r.id] = r.note || ""; }); setNotes(n);
  }, [reflections]);

  // "See the reflection" from a rewind opens that chat's day with the chat expanded.
  useEffect(() => {
    if (openId) { setDayOpen(dayKey(openId)); setOpen(openId); onOpened?.(); }
  }, [openId]); // eslint-disable-line

  const saveNote = (id) => {
    const note = notes[id];
    updateReflections(rs => rs.map(r => (r.id === id ? { ...r, note } : r)));
    setOpen(null);
  };

  // Deleting a chat also takes its minutes and can-do evidence out of your progress.
  const chatDelete = useUndoableDelete(id => { const r = reflections.find(x => x.id === id); if (r) deleteChat(r); });
  const shownReflections = reflections.filter(r => r.id !== chatDelete.pending?.id);

  const days = buildDays(progress.sessions.filter(s => s.ref !== chatDelete.pending?.id), shownReflections, words, progress.days);
  const todayKey = dayKey(Date.now()), yesterdayKey = dayKey(Date.now() - dayMs);
  const dayName = (d, long) => d.key === todayKey ? t("Hoy", "Today") : d.key === yesterdayKey ? t("Ayer", "Yesterday")
    : new Date(d.ts).toLocaleDateString(locale, long ? { weekday: "long", day: "numeric", month: "long" } : { weekday: "short", day: "numeric", month: "short" });
  const count = (n, es1, esN, en1, enN) => t(`${n} ${n === 1 ? es1 : esN}`, `${n} ${n === 1 ? en1 : enN}`);

  /* ---------- One day, opened ---------- */
  const day = dayOpen && days.find(d => d.key === dayOpen);
  if (day) {
    const fixes = day.chats.reduce((n, r) => n + (r.fixes?.length || 0), 0);
    return (
      <div className="pad">
        <button className="backLink" onClick={() => { setDayOpen(null); setOpen(null); }}><Icon name="back" size={18} /> {t("Tu español", "Your Spanish")}</button>
        <h1 className="display dayTitle">{dayName(day, true)}</h1>
        <div className="statGrid">
          <div className="stat"><b>{day.minutes}</b><span>{t("min hablados", "min spoken")}</span></div>
          <div className="stat"><b>{day.words.length}</b><span>{t(day.words.length === 1 ? "palabra" : "palabras", day.words.length === 1 ? "word" : "words")}</span></div>
          <div className="stat"><b>{day.reviews}</b><span>{t(day.reviews === 1 ? "repaso" : "repasos", day.reviews === 1 ? "review" : "reviews")}</span></div>
        </div>
        {(fixes > 0 || day.texts > 0) && (
          <p className="sub dayExtra">
            {[fixes > 0 && count(fixes, "corrección", "correcciones", "fix", "fixes"), day.texts > 0 && count(day.texts, "mensaje enviado", "mensajes enviados", "text sent", "texts sent")].filter(Boolean).join(" · ")}
          </p>
        )}
        {chatDelete.pending && (
          <div className="undoToast">
            <span>{t(`Borrada: ${chatDelete.pending.label}`, `Deleted: ${chatDelete.pending.label}`)}</span>
            <button onClick={chatDelete.undo}>{t("Deshacer", "Undo")}</button>
          </div>
        )}

        <h2 className="sectionHead">{t("Charlas", "Chats")}</h2>
        {day.chats.length === 0 && <p className="sub">{t("Este día no hubo charlas.", "No chats this day.")}</p>}
        {day.chats.map(r => (
          <div key={r.id} className="reflCard">
            <div className="reflHead">
              <button className="reflToggle" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                <b><TapPhrase es={r.scenario} en={r.sceneTitleEn || r.scenario} /></b>
                <span className="dim">{new Date(r.id).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}</span>
              </button>
              <button className="iconBtn small" onClick={() => chatDelete.remove(r.id, r.scenario)} aria-label={t("Borrar esta charla", "Delete this chat")}><Icon name="close" size={15} /></button>
            </div>
            {open === r.id && (
              <div className="reflBody">
                <p>{t(plain(r.summary_es) || plain(r.summary), plain(r.summary))}</p>
                {r.can_now_say?.length > 0 && (
                  <div className="canSay">
                    <div className="cardLabel">{t("Ya puedes decir", "You can now say")}</div>
                    {r.can_now_say.map((s, i) => (
                      <div key={i} className="canSayItem">“<TapText text={s} gloss={gloss} lookup={lookupWord} />” <SpeakBtn text={s} rate={0.85} /></div>
                    ))}
                  </div>
                )}
                {r.fixes?.length > 0 && (
                  <div className="reflFixes">
                    <div className="cardLabel">{t("Más natural", "More natural")}</div>
                    {r.fixes.map((f, i) => (
                      <div key={i} className="reflFix"><s>{f.you_said}</s> → <b>{f.better}</b> <SpeakBtn text={f.better} /></div>
                    ))}
                  </div>
                )}
                {r.questions?.length > 0 && <div className="cardLabel">{t("Para pensar", "To think about")}</div>}
                {r.questions?.map((q, i) => <div key={i} className="reflQ">{t(plain(r.questions_es?.[i]) || plain(q), plain(q))}</div>)}
                <textarea value={notes[r.id] || ""} onChange={e => setNotes({ ...notes, [r.id]: e.target.value })}
                          aria-label={t("Tu nota", "Your note")} placeholder={t("Lo que piensas. Con una frase basta.", "Your thoughts. A sentence is enough.")} rows={3} />
                <button className="cta small" onClick={() => saveNote(r.id)}>{t("Guardar nota", "Save note")}</button>

                {r.transcript?.length > 0 && (
                  <div className="translist">
                    <button className="tool" onClick={() => setShowTranscript(s => ({ ...s, [r.id]: !s[r.id] }))} aria-expanded={!!showTranscript[r.id]}>
                      {showTranscript[r.id] ? t("Ocultar la conversación", "Hide the conversation") : t("Ver la conversación", "See the conversation")}
                    </button>
                    {showTranscript[r.id] && (
                      <div className="transBody">
                        {r.transcript.map((m, i) => (
                          <div key={i} className={"tRow " + m.role}>
                            <b>{m.role === "me" ? t("Tú", "You") : r.partner || t("Compañero", "Partner")}:</b> <TapText text={m.es} gloss={gloss} lookup={lookupWord} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        <h2 className="sectionHead">{t("Palabras que guardaste", "Words you saved")}</h2>
        {day.words.length === 0 ? <p className="sub">{t("Este día no guardaste palabras.", "No words saved this day.")}</p> : (
          <div className="deckList">
            {day.words.map(w => (
              <button key={w.es} className="deckRow deckWord" onClick={() => speak(w.es)}>
                <span><b>{w.es}</b> <span className="dim">· {w.en}</span></span>
                <Icon name="speaker" size={16} />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* ---------- Overview ---------- */
  const shownDays = allDays ? days : days.slice(0, 8);
  return (
    <div className="pad">
      <ScreenTitle es="Tu español" en="Your Spanish" />
      <Tip tip={tip} points={[
        "At the top: the minutes you've spoken this week.",
        "Goals tick themselves off when you manage them in a chat. Tap Practise to jump into a scene for one.",
        "Tap a day to see its chats and the words you saved.",
      ]} />
      <WeekMinutes sessions={progress.sessions} />
      <h2 className="sectionHead">{t("Lo que ya puedes hacer en español", "What you can do in Spanish")}</h2>
      <CanDoMap cando={progress.cando} gloss={gloss} lookupWord={lookupWord} onPractice={onPractice} />
      <h2 className="sectionHead">{t("Tus días", "Your days")}</h2>
      {days.length === 0 ? (
        <p className="sub">{t("Cuando hables, repases o escribas a alguien, aparecerá aquí el día con todo lo que hiciste.", "When you talk, review or text someone, the day shows up here with everything you did.")}</p>
      ) : (
        <div className="dayGrid">
          {shownDays.map(d => (
            <button key={d.key} className={"dayBlock" + (d.key === todayKey ? " today" : "")} onClick={() => setDayOpen(d.key)}>
              <span className="dayName">{dayName(d)}</span>
              {d.minutes > 0 && <span className="dayMin">{d.minutes}<small> min</small></span>}
              <span className="dayMeta">
                {d.chats.length > 0 && <span>{count(d.chats.length, "charla", "charlas", "chat", "chats")}</span>}
                {d.words.length > 0 && <span>{count(d.words.length, "palabra", "palabras", "word", "words")}</span>}
                {d.reviews > 0 && <span>{count(d.reviews, "repaso", "repasos", "review", "reviews")}</span>}
                {d.texts > 0 && <span>{count(d.texts, "mensaje", "mensajes", "text", "texts")}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {days.length > 8 && !allDays && <button className="linkRow" onClick={() => setAllDays(true)}>{t("Ver todos los días", "See all days")}</button>}
    </div>
  );
}

/* ==================== CSS ==================== */
const css = `
* { box-sizing: border-box; margin: 0; }
button, input, textarea { font-family: inherit; }
button:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid ${T.ink}; outline-offset: 2px; }
.icon { display: inline-block; vertical-align: middle; flex-shrink: 0; }
.app { height: 100vh; height: 100dvh; background: ${T.paper}; color: ${T.ink}; font-family: 'Outfit', -apple-system, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; max-width: 560px; margin: 0 auto; }
.top { padding: calc(14px + env(safe-area-inset-top)) 20px 8px; display: flex; align-items: center; gap: 10px; }
.brand { font-family: 'Fraunces', Georgia, serif; font-size: 26px; font-weight: 600; letter-spacing: -0.5px; }
.dot { color: ${T.rosa}; width: 0.3em; height: 0.3em; margin-left: 0.06em; }
.tag { font-size: 11px; color: ${T.dim}; letter-spacing: 0.04em; flex: 1; }
.langSwitch { flex-shrink: 0; display: flex; gap: 2px; padding: 2px; border: 1.5px solid ${T.line}; border-radius: 99px; background: #fff; cursor: pointer; }
.langSwitch span { min-width: 34px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 99px; font-size: 12px; font-weight: 700; letter-spacing: .04em; color: ${T.dim}; }
.langSwitch span.on { background: ${T.ink}; color: ${T.paper}; }
@media (max-width: 360px) { .tag { display: none; } .langSwitch { margin-left: auto; } }
.loginTop { display: flex; justify-content: flex-end; padding: calc(14px + env(safe-area-inset-top)) 20px 0; }
.profileWrap { position: relative; }
.profileChip { border: none; background: none; padding: 0; cursor: pointer; border-radius: 50%; }
.profileAvatar { width: 28px; height: 28px; border-radius: 50%; display: block; object-fit: cover; }
.profileAvatarFallback { background: ${T.ink}; color: #fff; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.profileMenu { position: absolute; top: 36px; right: 0; background: #fff; border: 1.5px solid ${T.line}; border-radius: 14px; padding: 12px 14px; min-width: 230px; box-shadow: 0 4px 16px #0002; z-index: 10; text-align: left; }
.profileName { font-weight: 700; font-size: 13.5px; }
.profileEmail { font-size: 12px; margin-top: 1px; margin-bottom: 10px; word-break: break-all; }
.profileItem { width: 100%; display: flex; justify-content: space-between; gap: 10px; border: none; background: ${T.sand}; border-radius: 10px; padding: 8px 10px; margin-bottom: 8px; font-size: 12.5px; font-weight: 600; color: ${T.ink}; cursor: pointer; text-align: left; }
.profileItem { align-items: center; min-height: 40px; white-space: nowrap; }
.profileItem .dim { font-weight: 400; }
.linkBtn { background: none; border: none; padding: 0; font: inherit; color: ${T.rosa}; font-weight: 700; text-decoration: underline; cursor: pointer; }
.sheetVeil { position: fixed; inset: 0; background: #1B214566; z-index: 20; display: flex; align-items: flex-end; justify-content: center; }
.sheet { width: 100%; max-width: 560px; max-height: 88vh; overflow-y: auto; background: ${T.paper}; border-radius: 20px 20px 0 0; padding: 18px 16px 28px; }
.sheetHead { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.sheetTitle { font-family: 'Outfit', sans-serif; font-size: 22px; font-weight: 600; }
.sheetSub { font-size: 13px; color: ${T.dim}; line-height: 1.45; margin-bottom: 14px; }
.provList { display: flex; flex-direction: column; gap: 8px; }
.provRow { background: #fff; border: 1.5px solid ${T.line}; border-radius: 16px; overflow: hidden; }
.provRow.open { border-color: ${T.ink}55; }
.provHead { width: 100%; display: flex; align-items: center; gap: 10px; background: none; border: none; padding: 12px 14px; cursor: pointer; text-align: left; color: ${T.ink}; }
.provText { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.provName { font-weight: 700; font-size: 15px; }
.provSub { font-size: 12px; color: ${T.dim}; }
.provActive { background: ${T.leafSoft}; color: ${T.leaf}; font-size: 11px; font-weight: 700; border-radius: 99px; padding: 3px 9px; flex-shrink: 0; }
.provBody { padding: 0 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.provNote { font-size: 12.5px; color: ${T.dim}; line-height: 1.45; }
.provKeyRow { display: flex; justify-content: space-between; align-items: center; background: ${T.sand}; border-radius: 10px; padding: 8px 12px; font-size: 13px; }
.provLink { font-size: 12.5px; color: ${T.rosa}; font-weight: 600; text-decoration: none; }
.provModel { display: flex; flex-direction: column; }
.provModel input { border: 1.5px solid ${T.line}; border-radius: 10px; padding: 10px 12px; font-size: 14px; background: #fff; outline-color: ${T.rosa}; }
.provBody .cta.small { margin: 0; }
.cta:disabled, .miniBtn:disabled { opacity: .45; cursor: default; }
.profileLogout { width: 100%; border: 1.5px solid ${T.line}; background: #fff; border-radius: 99px; padding: 7px 0; font-size: 12.5px; font-weight: 700; color: ${T.rosa}; cursor: pointer; }

.loginWrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
.loginCard { max-width: 360px; text-align: center; background: #fff; border: 1.5px solid ${T.line}; border-radius: 20px; padding: 32px 28px; box-shadow: 0 2px 0 ${T.line}; }
.loginCard .brand { font-size: 30px; margin-bottom: 10px; }
.loginCard .sub { margin-bottom: 20px; }
.googleBtn { display: flex; align-items: center; justify-content: center; gap: 10px; border: 1.5px solid ${T.line}; border-radius: 99px; padding: 12px 20px; font-size: 14.5px; font-weight: 600; color: ${T.ink}; text-decoration: none; background: #fff; }
.googleBtn:active { background: ${T.sand}; }
.noticeBar { display: flex; align-items: center; gap: 10px; margin: 0 20px 10px; border-radius: 12px; padding: 6px 6px 6px 14px; font-size: 13px; line-height: 1.4; color: ${T.ink}; }
.noticeBar.problem { background: ${T.rosaSoft}; }
.noticeBar > span { flex: 1; }
.main { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.loading { padding: 40px; text-align: center; color: ${T.dim}; }
.pad { padding: 12px 20px 90px; overflow-y: auto; }
.center { text-align: center; }
.pad.center { padding-top: 60px; }
.display { font-family: 'Outfit', sans-serif; font-weight: 600; font-size: 30px; line-height: 1.12; letter-spacing: -0.5px; margin-bottom: 10px; }
.display em { font-style: normal; color: ${T.rosa}; }
.sub { color: ${T.dim}; font-size: 14.5px; line-height: 1.5; margin-bottom: 18px; }
.warn { background: ${T.sand}; border-radius: 12px; padding: 10px 14px; font-size: 13px; margin-bottom: 14px; }

.scenes { display: flex; flex-direction: column; gap: 10px; }
.sceneWrap { position: relative; }
.scene { width: 100%; display: flex; flex-direction: column; text-align: left; background: #fff; border: 1.5px solid ${T.line}; border-radius: 20px; padding: 0; overflow: hidden; cursor: pointer; color: ${T.ink}; transition: transform .12s, border-color .12s; }
.sceneArt { display: block; width: 100%; height: auto; aspect-ratio: 8 / 3; }
.sceneInfo { display: flex; gap: 12px; align-items: center; padding: 12px 14px 14px; }
.iconBtn.sceneDel { position: absolute; top: 8px; right: 8px; background: ${T.paper}; color: ${T.ink}; }
.chatArt { display: block; flex-shrink: 0; width: 100%; height: auto; aspect-ratio: 4 / 1; border-radius: 18px; }

.contactList { display: flex; flex-direction: column; gap: 8px; }
.contactRow { display: flex; align-items: center; gap: 12px; text-align: left; background: #fff; border: 1.5px solid ${T.line}; border-radius: 16px; padding: 12px 14px; cursor: pointer; width: 100%; }
.contactBody { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.contactName { font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 6px; }
.contactPreview { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.contactTime { font-size: 11px; flex-shrink: 0; }
.unreadDot { width: 8px; height: 8px; border-radius: 50%; background: ${T.rosa}; display: inline-block; }
.creator { background: ${T.sand}; border: 1.5px dashed ${T.ink}33; border-radius: 16px; padding: 14px; }
.creatorTitle { font-family: 'Outfit', sans-serif; font-size: 16px; font-weight: 600; }
.creatorSub { font-size: 12.5px; color: ${T.dim}; margin: 2px 0 10px; }
.creatorRow { display: flex; gap: 8px; }
.creatorRow input { flex: 1; border: 1.5px solid ${T.line}; border-radius: 99px; padding: 10px 14px; font-size: 14px; background: #fff; outline-color: ${T.rosa}; }
.creatorError { color: ${T.rosa}; font-size: 12.5px; margin-top: 8px; }
.helpCard { position: relative; background: ${T.leafSoft}; border-radius: 14px; padding: 12px 14px; margin-bottom: 10px; font-size: 14.5px; }
.cardClose { position: absolute; top: 4px; right: 4px; }
.starter { margin-bottom: 4px; }
.pistaBtn.wide { display: block; width: 100%; padding: 10px; margin-top: 8px; }
.helpFull { margin-top: 8px; }
.helpEn { font-size: 12.5px; color: ${T.dim}; font-style: italic; margin-top: 3px; }
.helpError { color: ${T.rosa}; font-size: 13px; }
.scene:active { transform: scale(.98); border-color: ${T.rosa}; }
.sceneBody { display: flex; flex-direction: column; gap: 2px; }
.sceneTitle { font-family: 'Outfit', sans-serif; font-size: 17px; font-weight: 600; }
.sceneGoal { font-size: 13px; }
.sceneWho { font-size: 12px; color: ${T.dim}; }

.chatWrap { display: flex; flex-direction: column; height: 100%; }
.chatHead { display: flex; align-items: center; gap: 10px; padding: 6px 12px 8px 6px; border-bottom: 1px solid ${T.line}; }
.chatTitle { font-weight: 700; font-size: 15px; }
.chatGoal { font-size: 12.5px; color: ${T.dim}; }
.chatHeadText { min-width: 0; flex: 1; }
.chatHeadText .chatGoal { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.endBtn { flex-shrink: 0; min-height: 40px; background: #fff; color: ${T.ink}; border: 1.5px solid ${T.line}; border-radius: 99px; padding: 0 16px; font-weight: 600; font-size: 14px; cursor: pointer; }
.endBtn:disabled { opacity: .4; }
.needMoreNote { font-size: 12px; color: ${T.dim}; text-align: center; padding: 6px 14px 0; }
.needMoreNote.err { color: ${T.rosa}; }
.msgs { flex: 1; overflow-y: auto; padding: 16px 14px 8px; display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; flex-direction: column; }
.row.me { align-items: flex-end; }
.row.ai { align-items: flex-start; }
.bubble { max-width: 82%; padding: 10px 14px; border-radius: 18px; font-size: 15.5px; line-height: 1.45; }
.bubble.ai { background: #fff; border: 1.5px solid ${T.line}; border-bottom-left-radius: 6px; }
.w { cursor: pointer; border-bottom: 1px dotted ${T.ink}1C; }
.phrase { cursor: pointer; }
.w:active { background: ${T.rosaSoft}; }
.wG { display: inline-block; background: ${T.ink}; color: #fff; font-size: 11px; line-height: 1.3; border-radius: 6px; padding: 1px 6px; margin: 0 3px; vertical-align: 2px; font-style: normal; }
.pistaMask { text-align: center; font-family: 'Outfit', sans-serif; font-size: 22px; letter-spacing: 1px; color: ${T.rosa}; background: ${T.rosaSoft}; border-radius: 12px; padding: 10px; margin-bottom: 10px; }
.revealRow { display: flex; gap: 10px; align-items: stretch; }
.pistaBtn { border: 1.5px solid ${T.line}; background: #fff; border-radius: 14px; padding: 0 16px; font-size: 14px; font-weight: 700; color: ${T.ink}; cursor: pointer; }
.cta.inRow { flex: 1; margin: 0; }
.spkBtn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; vertical-align: middle; border: none; border-radius: 50%; background: none; color: ${T.ink}; cursor: pointer; }
.spkBtn:hover { background: ${T.ink}0D; }
.bubble.me { background: ${T.ink}; color: #fff; border-bottom-right-radius: 6px; }
.bubble.err { color: ${T.rosa}; font-size: 13px; cursor: default; }
.typing { color: ${T.dim}; font-size: 10px; letter-spacing: 3px; }
.bubbleTools { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.tool { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; background: ${T.sand}; border: none; border-radius: 99px; padding: 0 11px; font-size: 12.5px; font-weight: 600; cursor: pointer; color: ${T.ink}; }
.tool.center { margin: 0 auto; }
.hintText { margin-top: 6px; font-size: 12.5px; font-style: italic; color: ${T.dim}; }
.correction { margin-top: 6px; max-width: 82%; background: ${T.rosaSoft}; border-radius: 12px; padding: 8px 12px; font-size: 13px; }
.correction b { cursor: pointer; }
.corrLabel { display: block; color: ${T.rosaDeep}; font-weight: 700; font-size: 12px; margin-bottom: 2px; }
.corrWhy { color: ${T.dim}; font-size: 12px; margin-top: 2px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; max-width: 90%; }
.chip { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; background: ${T.sand}; border: 1.5px dashed ${T.ink}33; border-radius: 99px; padding: 0 12px; font-size: 13px; cursor: pointer; color: ${T.ink}; }
.chip.saved { background: ${T.leafSoft}; border: 1.5px solid ${T.leaf}55; color: ${T.leaf}; }

.talkBar { border-top: 1px solid ${T.line}; padding: 8px 14px calc(12px + env(safe-area-inset-bottom)); }
.liveText { min-height: 20px; text-align: center; font-size: 13.5px; color: ${T.dim}; font-style: italic; margin-bottom: 6px; }
.liveText.tall { min-height: 24px; margin: 8px 0 4px; }
.liveText.err { color: ${T.rosa}; font-style: normal; font-weight: 600; }
.talkRow { display: flex; align-items: center; justify-content: center; gap: 22px; }
.talkRow.center { margin-top: 6px; }
.talkBtn { width: 76px; height: 76px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: none; background: ${T.rosa}; color: #fff; cursor: pointer; box-shadow: 0 4px 0 #A82554; transition: transform .1s; }
.talkBtn:active { transform: translateY(2px); box-shadow: 0 2px 0 #A82554; }
.talkBtn:disabled { opacity: .4; }
.talkBtn.small { width: 64px; height: 64px; font-size: 24px; }
.talkBtn.live { background: ${T.ink}; box-shadow: 0 4px 0 #0D1030; animation: pulse 1.2s infinite; }
@keyframes pulse { 0%,100% { outline: 6px solid ${T.rosa}33; } 50% { outline: 12px solid ${T.rosa}22; } }
@media (prefers-reduced-motion: reduce) { .talkBtn.live { animation: none; } .veilAnswer { animation: none; } }
.sideTool { width: 46px; height: 46px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 1.5px solid ${T.line}; background: #fff; color: ${T.ink}; cursor: pointer; }
.typeRow { display: flex; gap: 8px; align-items: center; }
.typeRow input { flex: 1; border: 1.5px solid ${T.line}; border-radius: 99px; padding: 12px 16px; font-size: 15px; background: #fff; outline-color: ${T.rosa}; }
.sendBtn { width: 46px; height: 46px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: none; background: ${T.rosa}; color: #fff; cursor: pointer; }
.sendBtn:disabled { opacity: .35; }

.progress { display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; color: ${T.dim}; margin-bottom: 6px; }
.progressBar { height: 4px; border-radius: 2px; background: ${T.sand}; margin-bottom: 12px; overflow: hidden; }
.progressBar span { display: block; height: 100%; background: ${T.rosa}; transition: width .25s; }
.sessionFoot { display: flex; justify-content: center; gap: 18px; }
.sessionFoot .undoRow { width: auto; display: inline-flex; align-items: center; gap: 5px; min-height: 40px; }
.card { background: #fff; border: 1.5px solid ${T.line}; border-radius: 20px; padding: 22px 18px; box-shadow: 0 2px 0 ${T.line}; }
.cardLabel { font-size: 12px; color: ${T.dim}; margin-bottom: 4px; font-weight: 600; }
.cardEn { font-family: 'Outfit', sans-serif; font-size: 26px; font-weight: 600; margin-bottom: 6px; }
.cardEx { color: ${T.dim}; font-style: italic; font-size: 14px; margin-bottom: 10px; }
.attempt { width: 100%; border: 1.5px solid ${T.line}; border-radius: 12px; padding: 12px 14px; font-size: 16px; margin-bottom: 4px; outline-color: ${T.rosa}; }
.veilAnswer { background: ${T.rosaSoft}; border-radius: 14px; padding: 14px; margin-bottom: 12px; animation: pop .18s ease-out; }
@keyframes pop { from { transform: scale(.96); opacity: 0; } }
.answerEs { display: inline-flex; align-items: center; gap: 8px; padding: 0; border: none; background: none; text-align: left; font-family: 'Outfit', sans-serif; font-size: 24px; font-weight: 600; color: ${T.rosaDeep}; cursor: pointer; }
.answerEx { font-size: 14px; margin-top: 4px; font-style: italic; cursor: pointer; }
.attemptCheck { font-size: 12.5px; color: ${T.dim}; margin-top: 6px; }
.attemptCheck.yes { color: ${T.leaf}; font-weight: 700; display: flex; align-items: center; gap: 4px; }
.gradeRow { display: flex; gap: 10px; }
.gradeBtn { flex: 1; border: none; border-radius: 14px; padding: 12px; font-size: 15px; font-weight: 700; cursor: pointer; display: flex; flex-direction: column; gap: 2px; align-items: center; }
.gradeBtn span { font-size: 12px; font-weight: 400; opacity: .85; }
.gradeBtn.no { background: ${T.sand}; color: ${T.ink}; }
.gradeBtn.yes { background: ${T.leaf}; color: #fff; }
.undoRow { display: block; width: 100%; background: none; border: none; color: ${T.dim}; font-size: 12.5px; text-align: center; padding: 10px 0 0; cursor: pointer; }
.undoToast { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: ${T.sand}; border-radius: 12px; padding: 9px 14px; font-size: 13px; margin-bottom: 12px; }
.undoToast button { background: none; border: none; color: ${T.rosa}; font-weight: 700; font-size: 13px; cursor: pointer; }
.cta { display: block; width: 100%; background: ${T.rosa}; color: #fff; border: none; border-radius: 14px; padding: 14px; font-size: 16px; font-weight: 700; cursor: pointer; margin: 6px 0 16px; }
.cta.small { padding: 10px; font-size: 14px; margin: 8px 0 0; }
.doneNote { background: ${T.leafSoft}; color: ${T.leaf}; border-radius: 12px; padding: 10px 14px; font-size: 13.5px; margin-bottom: 12px; font-weight: 600; }
.deckList { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.deckRow { display: flex; justify-content: space-between; align-items: center; background: #fff; border: 1px solid ${T.line}; border-radius: 12px; padding: 10px 14px; font-size: 14px; cursor: pointer; }
.dueTag { font-size: 11px; color: ${T.dim}; background: ${T.sand}; border-radius: 99px; padding: 3px 8px; }
.dim { color: ${T.dim}; }
.toolCards { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.toolCard { width: 100%; display: flex; gap: 12px; align-items: center; text-align: left; background: #fff; border: 1.5px solid ${T.line}; border-radius: 16px; padding: 12px 14px; cursor: pointer; font-size: 14.5px; color: ${T.ink}; }
.toolCard > span:last-child { display: flex; flex-direction: column; gap: 2px; }
.toolCard .dim { font-size: 12.5px; line-height: 1.4; }
.toolIcon { width: 40px; height: 40px; flex-shrink: 0; border-radius: 12px; background: ${T.sand}; display: flex; align-items: center; justify-content: center; }
.addForm { display: flex; flex-direction: column; gap: 8px; background: ${T.sand}; border-radius: 14px; padding: 12px; margin-bottom: 12px; }
.addForm input { border: 1.5px solid ${T.line}; border-radius: 10px; padding: 10px 12px; font-size: 14px; background: #fff; outline-color: ${T.rosa}; }
.scanCard { position: relative; background: ${T.leafSoft}; border-radius: 14px; padding: 12px 14px; margin-bottom: 12px; font-size: 14px; }
.scanText { font-size: 15px; line-height: 1.5; margin-bottom: 10px; }
.scanTrans { color: ${T.dim}; font-style: italic; margin-bottom: 10px; }
.scanCard .deckRow { margin-bottom: 6px; }
.deck { margin-top: 6px; }
.deckToggle { width: 100%; display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 0 14px; background: #fff; border: 1.5px solid ${T.line}; border-radius: 16px; color: ${T.ink}; font-size: 15px; font-weight: 700; cursor: pointer; text-align: left; }
.deckToggle > span:first-child { flex: 1; }
.deckToggle .dim { font-size: 13px; font-weight: 500; }
.chev { display: flex; transform: rotate(-90deg); transition: transform .15s; color: ${T.dim}; }
.chev.open { transform: rotate(90deg); }
.deckWord { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; background: none; border: none; padding: 0; text-align: left; color: ${T.ink}; font-size: 14px; cursor: pointer; }
.deckRow.deckWord { padding: 10px 14px; background: #fff; border: 1px solid ${T.line}; }
.deckRight { display: flex; align-items: center; gap: 6px; }
.miniBtn { background: none; border: 1px solid ${T.line}; border-radius: 99px; padding: 3px 9px; font-size: 11px; color: ${T.dim}; cursor: pointer; }
.miniBtn.add { background: ${T.leaf}; color: #fff; border-color: ${T.leaf}; font-weight: 700; }
.mnemo { display: flex; gap: 6px; align-items: flex-start; margin-top: 10px; font-size: 13.5px; line-height: 1.45; background: #fff8; border-radius: 10px; padding: 8px 10px; }
.answerEn { font-size: 15px; color: ${T.ink}; margin-top: 2px; }
.bigSpk { display: flex; align-items: center; justify-content: center; margin: 8px auto 10px; width: 84px; height: 84px; border-radius: 50%; border: none; background: ${T.rosa}; color: #fff; cursor: pointer; box-shadow: 0 4px 0 #A82554; }
.howNote { margin-top: 16px; font-size: 12.5px; color: ${T.dim}; line-height: 1.5; }

.reflCard { background: #fff; border: 1.5px solid ${T.line}; border-radius: 16px; margin-bottom: 10px; overflow: hidden; }
.reflHead { display: flex; align-items: center; padding: 4px 6px 4px 0; }
.reflToggle { flex: 1; display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 48px; padding: 0 10px 0 16px; background: none; border: none; color: ${T.ink}; font-size: 14.5px; text-align: left; cursor: pointer; }
.reflBody { padding: 0 16px 16px; font-size: 14px; line-height: 1.5; }
.reflBody p { margin-bottom: 12px; }
.canSay { background: ${T.leafSoft}; border-radius: 12px; padding: 10px 12px; margin-bottom: 12px; }
.canSayItem { font-family: 'Outfit', sans-serif; font-size: 15px; color: ${T.leaf}; margin-top: 2px; }
.reflQ { background: ${T.sand}; border-radius: 10px; padding: 8px 12px; margin-bottom: 6px; font-size: 13.5px; }
.reflBody textarea { width: 100%; border: 1.5px solid ${T.line}; border-radius: 12px; padding: 10px 12px; font-size: 14px; font-family: inherit; margin-top: 8px; outline-color: ${T.rosa}; resize: vertical; }
.translist { margin-top: 10px; }
.transBody { margin-top: 8px; background: ${T.sand}; border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.tRow { font-size: 13.5px; }
.tRow b { color: ${T.dim}; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; margin-right: 4px; }

/* Shared bits: icon buttons, avatars, tips */
.iconBtn { width: 44px; height: 44px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: 50%; background: none; color: ${T.ink}; cursor: pointer; }
.iconBtn:hover { background: ${T.ink}0D; }
.iconBtn.small { width: 34px; height: 34px; color: ${T.dim}; }
.iconBtn.info { color: ${T.dim}; }
.iconBtn.light { color: ${T.paper}; }
.iconBtn.light:hover { background: #FFFDF71A; }
.avatar { flex-shrink: 0; border-radius: 50%; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: 'Outfit', sans-serif; font-weight: 600; }
.screenTitle { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.screenTitle .display { flex: 1; }
.screenTitle .iconBtn { margin: -4px -10px 0 0; }
.tipCard { background: ${T.sand}; color: ${T.ink}; border-radius: 16px; margin-bottom: 14px; }
.tipCard.open { background: ${T.ink}; color: ${T.paper}; }
.msgs .tipCard { margin-bottom: 4px; flex-shrink: 0; }
.tipHead { width: 100%; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 12px 0 14px; border: none; background: none; color: inherit; font-size: 14px; font-weight: 600; text-align: left; cursor: pointer; }
.tipTitle { flex: 1; }
.tipCard .chev { color: inherit; opacity: .7; }
.tipList { margin: 0; padding: 0 16px 14px 34px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; line-height: 1.45; color: #E4E6F2; }
.tipList li::marker { color: #F49AB8; }
.emptyThread { text-align: center; color: ${T.dim}; font-size: 14px; margin: 24px 20px; }
.backLink { display: inline-flex; align-items: center; gap: 4px; min-height: 40px; margin: 0 0 4px -6px; padding: 0 6px; border: none; background: none; color: ${T.dim}; font-size: 14px; font-weight: 600; cursor: pointer; }
.dayTitle::first-letter { text-transform: uppercase; }
.dayGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.dayBlock { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-height: 96px; padding: 12px 14px; background: #fff; border: 1.5px solid ${T.line}; border-radius: 18px; text-align: left; color: ${T.ink}; cursor: pointer; }
.dayBlock.today { border-color: ${T.rosa}66; background: ${T.rosaSoft}66; }
.dayName { font-size: 13.5px; font-weight: 700; }
.dayName::first-letter { text-transform: uppercase; }
.dayMin { font-family: 'Outfit', sans-serif; font-size: 26px; font-weight: 600; line-height: 1.1; }
.dayMin small { font-family: 'Outfit', sans-serif; font-size: 13px; font-weight: 600; }
.dayMeta { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: auto; font-size: 12.5px; color: ${T.dim}; }
.privacyNow { display: flex; align-items: center; gap: 8px; background: ${T.sand}; border-radius: 12px; padding: 10px 12px; font-size: 13.5px; font-weight: 600; margin: 8px 0 4px; }
.privacySection { margin: 14px 0; }
.privacySection h3 { font-size: 15px; font-weight: 700; margin-bottom: 4px; }
.privacySection p { font-size: 14px; line-height: 1.5; color: ${T.ink}; }
.loginWrap { position: relative; }
.loginTitle { font-family: 'Outfit', sans-serif; font-size: 24px; font-weight: 600; line-height: 1.2; letter-spacing: -0.3px; margin-bottom: 10px; }
.loginHint { margin-top: 16px; font-size: 12.5px; color: ${T.dim}; }

/* Lifeline */
.toolCol { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 84px; font-size: 11px; font-weight: 600; color: ${T.dim}; }
.lifelineBtn { width: 46px; height: 46px; border-radius: 50%; border: none; background: ${T.ink}; color: ${T.paper}; font-family: 'Outfit', sans-serif; font-size: 22px; font-weight: 600; cursor: pointer; flex-shrink: 0; }
.lifelineBtn.small { width: 44px; height: 44px; font-size: 20px; flex-shrink: 0; }
.lifelineBtn:disabled { opacity: .4; }
.lifelineBtn.pulse { animation: lifePulse 1.4s infinite; }
@keyframes lifePulse { 0%,100% { box-shadow: 0 0 0 4px ${T.rosa}40; } 50% { box-shadow: 0 0 0 10px ${T.rosa}1A; } }
@media (prefers-reduced-motion: reduce) { .lifelineBtn.pulse { animation: none; box-shadow: 0 0 0 4px ${T.rosa}55; } }
.lifeLabel { color: #B8285A; font-weight: 700; white-space: nowrap; }
.stuckTip { margin: 0 0 8px auto; max-width: 240px; background: ${T.ink}; color: ${T.paper}; font-size: 13px; line-height: 1.35; border-radius: 14px; padding: 9px 12px; }
.pinCard { display: flex; align-items: center; gap: 4px; background: ${T.rosaSoft}; border-radius: 14px; padding: 2px 4px 2px 6px; margin-bottom: 10px; }
.pinText { flex: 1; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 6px; border: none; background: none; text-align: left; color: ${T.ink}; font-family: 'Outfit', sans-serif; font-size: 17px; font-weight: 600; cursor: pointer; }
.lifeSheet { display: flex; flex-direction: column; gap: 14px; }
.lifeSheet .sheetSub { margin: 0; }
.lifeKicker { font-family: 'Outfit', sans-serif; font-size: 20px; font-weight: 600; color: ${T.rosaDeep}; }
.lifeAsk { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.talkBtn.ink { background: ${T.ink}; box-shadow: 0 4px 0 #0D1030; }
.talkBtn.ink.live { background: ${T.rosa}; box-shadow: 0 4px 0 #A82554; }
.lifeIdeas { align-self: center; font-size: 13.5px; }
.lifeSaid { display: flex; flex-direction: column; }
.lifeEn { font-style: italic; color: ${T.dim}; font-size: 15px; }
.lifeError { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: ${T.rosa}; font-size: 13.5px; }
.lifeEs { font-family: 'Outfit', sans-serif; font-size: 28px; font-weight: 600; line-height: 1.2; letter-spacing: -0.4px; }
.lifeChunks { display: flex; flex-wrap: wrap; gap: 8px; }
.lifeChunk { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; min-height: 48px; border: none; background: ${T.sand}; border-radius: 12px; padding: 7px 12px; cursor: pointer; color: ${T.ink}; font-size: 15px; }
.lifeChunk span { font-size: 11.5px; color: ${T.dim}; }
.lifePlay { display: flex; gap: 10px; }
.pillBtn { flex: 1; height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1.5px solid ${T.line}; border-radius: 99px; background: #fff; color: ${T.ink}; font-size: 14px; font-weight: 600; cursor: pointer; }
.pillBtn.strong { border-color: ${T.ink}; }
.lifeNote { font-size: 13.5px; line-height: 1.4; background: ${T.paper}; border: 1px solid ${T.line}; border-radius: 12px; padding: 10px 12px; }
.cta.lifeGo { margin: 0; padding: 16px; border-radius: 99px; display: flex; align-items: center; justify-content: center; gap: 8px; }
.savedToast span { display: inline-flex; align-items: center; gap: 5px; }
.savedToast { align-self: center; display: flex; align-items: center; gap: 4px; background: ${T.leafSoft}; color: ${T.leaf}; border-radius: 99px; padding: 0 4px 0 14px; font-size: 13.5px; font-weight: 600; min-height: 40px; }
.savedToast button { background: none; border: none; color: ${T.leaf}; font-weight: 700; text-decoration: underline; padding: 0 10px; min-height: 40px; cursor: pointer; font-size: 13.5px; }
.savedToast.quiet { background: ${T.sand}; color: ${T.dim}; padding: 0 14px; }

/* Rewind */
.rewindWrap { display: flex; flex-direction: column; height: 100%; }
.pad.rewind { flex: 1; padding-bottom: 16px; }
.rewindHead { display: flex; align-items: center; justify-content: space-between; margin: 0 -6px 6px; }
.rewindKicker { font-size: 13px; font-weight: 600; color: ${T.dim}; }
.rewindSpacer { width: 44px; }
.rewind .display { margin-bottom: 2px; }
.rewind .sub { margin-bottom: 14px; }
.statGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px; }
.stat { display: flex; flex-direction: column; gap: 2px; background: ${T.sand}; border-radius: 14px; padding: 10px 12px; }
.stat b { font-family: 'Outfit', sans-serif; font-size: 24px; font-weight: 600; }
.stat span { font-size: 12px; color: ${T.dim}; }
.sectionHead { font-size: 15px; font-weight: 700; margin: 18px 0 8px; }
.fixCard { display: flex; flex-direction: column; gap: 10px; background: #fff; border: 1.5px solid ${T.line}; border-radius: 18px; padding: 14px; margin-bottom: 10px; }
.fixCard.off .fixLine, .fixCard.off .fixWhy { opacity: .55; }
.fixLine { display: flex; align-items: center; gap: 10px; }
.fixText { flex: 1; display: flex; flex-direction: column; font-size: 16.5px; line-height: 1.35; }
.fixText .cardLabel { margin-bottom: 2px; }
.fixOld { color: #B8285A; }
.fixNew { background: ${T.leafSoft}; color: ${T.leaf}; font-weight: 700; border-radius: 6px; padding: 0 4px; }
.playBtn { width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%; border: 1.5px solid ${T.line}; background: #fff; color: ${T.ink}; font-size: 13px; cursor: pointer; }
.playBtn.strong { background: ${T.ink}; border-color: ${T.ink}; color: ${T.paper}; }
.playBtn.light { width: 36px; height: 36px; background: ${T.paper}; border: none; color: ${T.ink}; vertical-align: middle; margin-left: 6px; }
.fixWhy { font-size: 13.5px; line-height: 1.4; color: ${T.dim}; }
.fixKeep { display: flex; align-items: center; justify-content: space-between; min-height: 44px; padding-top: 8px; border-top: 1px solid ${T.line}; font-size: 14px; font-weight: 600; cursor: pointer; }
.fixKeep input { appearance: none; -webkit-appearance: none; width: 48px; height: 28px; border-radius: 14px; background: #D9D4C5; position: relative; cursor: pointer; transition: background .15s; margin: 0; }
.fixKeep input::after { content: ""; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: transform .15s; }
.fixKeep input:checked { background: ${T.rosa}; }
.fixKeep input:checked::after { transform: translateX(20px); }
.fixKeep input:focus-visible { outline: 2px solid ${T.ink}; outline-offset: 2px; }
.rewindFoot { border-top: 1px solid ${T.line}; padding: 10px 20px calc(8px + env(safe-area-inset-bottom)); background: ${T.paper}; }
.rewindFoot .cta { margin: 0 0 2px; border-radius: 99px; }
.linkRow { display: block; width: 100%; min-height: 40px; background: none; border: none; color: ${T.ink}; font-size: 14.5px; font-weight: 600; cursor: pointer; }
.linkRow.quiet { color: ${T.dim}; font-weight: 500; font-size: 13px; min-height: 32px; }

/* Can-do unlocked */
.unlocked { position: fixed; inset: 0; z-index: 30; background: ${T.ink}; color: ${T.paper}; display: flex; flex-direction: column; padding: 16px 20px 28px; max-width: 560px; margin: 0 auto; }
.unlockedHead { display: flex; justify-content: flex-end; }
.unlockedBody { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; text-align: center; }
.unlockedMark { width: 120px; height: 120px; }
.unlockedKicker { font-size: 14px; font-weight: 700; color: #F49AB8; }
.unlockedTitle { font-family: 'Outfit', sans-serif; font-size: 34px; font-weight: 600; line-height: 1.1; letter-spacing: -0.5px; max-width: 340px; }
.unlockedQuote { align-self: stretch; display: flex; flex-direction: column; gap: 8px; text-align: left; background: #FFFDF714; border-radius: 20px; padding: 16px; }
.unlockedQuote span { font-size: 13px; font-weight: 600; color: #C9CCE0; }
.unlockedQuote p { font-size: 17px; font-style: italic; line-height: 1.4; }
.unlockedArea { font-size: 14px; color: #C9CCE0; }
.unlockedFoot { display: flex; flex-direction: column; gap: 10px; }
.unlockedFoot .cta { margin: 0; border-radius: 99px; }
.ghostBtn { height: 50px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 1.5px solid #FFFDF766; border-radius: 99px; background: none; color: ${T.paper}; font-size: 15px; font-weight: 600; cursor: pointer; }

/* Review cards from chats */
.ctxRow { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.cardKind { align-self: flex-start; background: ${T.sand}; border-radius: 99px; padding: 4px 10px; font-size: 12px; font-weight: 600; color: ${T.dim}; }
.ctxLine { display: flex; align-items: center; gap: 12px; font-size: 16px; }
.ctxLine .cardLabel { display: block; margin-bottom: 2px; }
.pistaWhy { font-size: 13.5px; color: ${T.ink}; background: ${T.sand}; border-radius: 12px; padding: 8px 12px; margin-bottom: 8px; }
.answerWhy { font-size: 13px; color: ${T.dim}; margin-top: 4px; }
.kindTag { display: inline-block; font-size: 10.5px; font-weight: 700; border-radius: 99px; padding: 2px 7px; margin-right: 6px; vertical-align: 1px; }
.kindTag.mistake { background: ${T.rosaSoft}; color: #B8285A; }
.kindTag.lifeline { background: ${T.ink}14; color: ${T.ink}; }

/* Progreso */
.weekCard { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; background: ${T.ink}; color: ${T.paper}; border-radius: 20px; padding: 16px; }
.weekTotal { display: flex; flex-direction: column; gap: 2px; }
.weekKicker { font-size: 13px; font-weight: 600; color: #C9CCE0; }
.weekNum { font-family: 'Outfit', sans-serif; font-size: 44px; font-weight: 600; line-height: 1; }
.weekNum small { font-family: 'Outfit', -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 17px; margin-left: 4px; }
.weekDelta { font-size: 13px; font-weight: 600; color: #7BD3A0; }
.weekDelta.down { color: #C9CCE0; }
.weekBars { display: grid; grid-template-columns: repeat(7, 18px); gap: 6px; align-items: end; }
.weekDay { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 11px; color: #C9CCE0; }
.weekBar { width: 14px; border-radius: 4px; background: #C9CCE0; }
.weekDay.today { color: ${T.paper}; font-weight: 700; }
.weekDay.today .weekBar { background: ${T.rosa}; }
.weekDay.later .weekBar { background: #FFFDF733; }
.canDo { display: flex; flex-direction: column; gap: 8px; }
.areaCard { background: #fff; border: 1.5px solid ${T.line}; border-radius: 18px; overflow: hidden; }
.areaHead { width: 100%; display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 0 14px; background: none; border: none; cursor: pointer; color: ${T.ink}; text-align: left; }
.areaCard.open .areaHead { border-bottom: 1px solid ${T.line}; }
.areaName { flex: 1; font-size: 15.5px; font-weight: 700; }
.areaCount { font-size: 13px; font-weight: 600; color: ${T.dim}; }
.areaBar { width: 56px; height: 6px; border-radius: 3px; background: ${T.sand}; overflow: hidden; }
.areaBar span { display: block; height: 100%; background: ${T.leaf}; }
.canItem + .canItem { border-top: 1px solid ${T.line}; }
.canRow { width: 100%; display: flex; align-items: center; gap: 12px; min-height: 50px; padding: 4px 14px; background: none; border: none; color: ${T.ink}; text-align: left; font-size: 14.5px; cursor: pointer; }
.canIcon { width: 26px; height: 26px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: ${T.dim}; box-sizing: border-box; }
.canItem.done .canIcon { background: ${T.leaf}; color: #fff; font-size: 14px; font-weight: 700; }
.canItem.partial .canIcon { border: 3px solid ${T.sand}; border-top-color: ${T.rosa}; border-right-color: ${T.rosa}; }
.canText { flex: 1; }
.canItem.todo .canText { color: ${T.dim}; }
.canRowWrap { display: flex; align-items: center; padding-right: 12px; }
.practiceBtn { flex-shrink: 0; color: ${T.rosaDeep}; border-color: ${T.rosaSoft}; font-weight: 700; padding: 5px 10px; }
.canMeta { font-size: 12.5px; font-weight: 600; color: ${T.dim}; text-align: right; }
.canItem.done .canMeta { color: #B8285A; }
.canQuote { padding: 0 14px 12px 52px; font-size: 14.5px; font-style: italic; }
.canQuote .dim { font-style: normal; font-size: 12px; margin-top: 2px; }
.reflFixes { background: ${T.rosaSoft}; border-radius: 12px; padding: 10px 12px; margin-bottom: 12px; }
.reflFix { font-size: 14px; margin-top: 2px; }
.reflFix b { cursor: pointer; color: ${T.leaf}; }

.nav { position: fixed; z-index: 5; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 560px; display: flex; background: #fff; border-top: 1px solid ${T.line}; padding: 6px 0 calc(10px + env(safe-area-inset-bottom)); }
/* A conversation or its rewind takes the whole screen; its own back/close buttons lead out. */
.app:has(.chatWrap) .nav, .app:has(.rewindWrap) .nav, .app:has(.unlocked) .nav { display: none; }
.pad { padding-bottom: calc(90px + env(safe-area-inset-bottom)); }
.endErrorRow { display: flex; justify-content: center; gap: 8px; margin-top: 6px; }
.deckSearch { border: 1.5px solid ${T.line}; border-radius: 10px; padding: 9px 12px; font-size: 14px; background: #fff; outline-color: ${T.rosa}; }
.editRow { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
.editRow .cta { margin: 0; }
.dayExtra { margin-top: -4px; }
.navBtn { flex: 1; background: none; border: none; display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 11px; color: ${T.dim}; cursor: pointer; padding: 4px 0; }
.navBtn.on { color: ${T.rosa}; font-weight: 700; }
.navIcon { font-size: 20px; position: relative; }
.badge { position: absolute; top: -4px; right: -12px; background: ${T.rosa}; color: #fff; font-size: 10px; font-weight: 700; border-radius: 99px; min-width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; padding: 0 4px; }
`;
