import React, { useState, useEffect, useRef, useCallback, useContext, createContext } from "react";

/* ---------- Charla · audio-first ----------
   Palette: ink navy, rosa mexicano, lime leaf, sun ivory
   Display: Fraunces / Body: system sans
   Signature: the big talk button — the whole app orbits around speaking
------------------------------------------- */
const T = {
  ink: "#1B2145", rosa: "#D6336C", rosaSoft: "#FCE7F0",
  leaf: "#2E7D4F", leafSoft: "#E4F3E9",
  paper: "#FFFDF7", sand: "#F3EEE2", line: "#E5DFCE", dim: "#6B6F86",
};

const SCENARIOS = [
  { id: "mercado", emoji: "🍊", title: "En el mercado", titleEn: "At the market", goal: "Buy fruit and haggle a little", who: "Doña Rosa, a fruit vendor in Oaxaca", opener: "¡Buenos días! Tengo mangos muy dulces hoy. ¿Qué buscas?", hint: "Good morning! I have very sweet mangoes today. What are you looking for?" },
  { id: "cafe", emoji: "☕", title: "Café con un amigo nuevo", titleEn: "Coffee with a new friend", goal: "Talk about your real life — work, family, dreams", who: "Mateo, a friendly porteño from Buenos Aires", opener: "¡Hola! Qué bueno verte. Cuéntame, ¿qué haces en tu vida? ¿Trabajas o estudias?", hint: "Hi! So good to see you. Tell me, what do you do in life? Do you work or study?" },
  { id: "perdido", emoji: "🗺️", title: "Perdido en Madrid", titleEn: "Lost in Madrid", goal: "Ask for directions and help", who: "Lucía, a madrileña waiting for the bus", opener: "Perdona, ¿estás perdido? ¿A dónde quieres ir?", hint: "Excuse me, are you lost? Where do you want to go?" },
  { id: "dia", emoji: "🌙", title: "¿Cómo fue tu día?", titleEn: "How was your day?", goal: "Tell the story of your actual day", who: "Camila, your conversation buddy", opener: "¡Hola! Quiero saber todo. ¿Cómo fue tu día hoy? ¿Bueno o difícil?", hint: "Hi! I want to know everything. How was your day today? Good or hard?" },
  { id: "finde", emoji: "🎉", title: "Planes del fin de semana", titleEn: "Weekend plans", goal: "Make real weekend plans together", who: "Diego, who always has plans", opener: "¡Oye! ¿Qué haces este fin de semana? ¿Tienes planes?", hint: "Hey! What are you doing this weekend? Do you have plans?" },
];

const dayMs = 86400000;
const strip = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¿?¡!.,"“”]/g, "").trim();

/* Global "peek English" toggle — one tap flashes every static UI string + revealed
   glosses to English for a few seconds, then reverts to the Spanish-first default. */
const UIContext = createContext({ en: false, flash: () => {} });
const useUI = () => useContext(UIContext);
const useT = () => {
  const { en } = useUI();
  return useCallback((es, enText) => (en ? enText : es), [en]);
};

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

/* ---------- Voice engine (TTS + STT) ---------- */
const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
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
function speak(text, rate = 0.95, onEnd) {
  try {
    if (!esVoice) pickVoice(); // voices sometimes become available before onvoiceschanged fires
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = esVoice?.lang || "es-MX";
    if (esVoice) u.voice = esVoice;
    u.rate = rate;
    u.onend = () => {
      // Chrome leaves the TTS audio stream open for a beat after onend, which makes the OS
      // emit an audible pop when it's finally torn down — force an immediate close instead.
      speechSynthesis.cancel();
      onEnd?.();
    };
    speechSynthesis.speak(u);
  } catch {}
}
const hush = () => { try { speechSynthesis.cancel(); } catch {} };

/* Push-to-talk hook: tap to start, tap to stop (or auto-stop on silence) */
function useMic(onFinal) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState(null);
  const recRef = useRef(null);
  const finalRef = useRef("");
  const t = useT();

  const stop = useCallback(() => { try { recRef.current?.stop(); } catch {} }, []);

  const start = useCallback(() => {
    if (!SR) return;
    hush(); // don't record while the app is talking
    setError(null);
    finalRef.current = "";
    setInterim("");
    const rec = new SR();
    rec.lang = "es-MX";
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
      if (text) onFinal(text);
    };
    rec.onerror = (e) => {
      setListening(false);
      setInterim("");
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(e.error === "not-allowed" || e.error === "service-not-allowed"
        ? t("Permiso de micrófono denegado — actívalo en los ajustes del navegador.", "Microphone permission denied — enable it in your browser settings.")
        : t("Hubo un problema con el micrófono — inténtalo otra vez.", "There was a problem with the microphone — try again."));
    };
    recRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { setListening(false); setError(t("No se pudo iniciar el micrófono.", "Couldn't start the microphone.")); }
  }, [onFinal, t]);

  return { supported: !!SR, listening, interim, start, stop, error };
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

function buildSystemPrompt(sc) {
  return `You are ${sc.who}, having a SPOKEN conversation with a BEGINNER Spanish learner (A1–A2). Scenario: "${sc.title}". Learner's goal: ${sc.goal}.
The learner is SPEAKING and their words arrive via imperfect speech recognition — be forgiving of odd transcriptions and guess the intended meaning.
Rules:
- Reply in simple spoken Spanish, max 2 short sentences, warm and natural. No emojis, no formatting (it will be read aloud).
- Have a MEANINGFUL conversation: ask about the learner's real life, opinions, feelings. Never stall on greetings.
- Always end with one question.
- If the learner clearly made a language error (not a transcription glitch), give a recast in "correction". Otherwise null.
- Introduce at most 2 genuinely useful new words/phrases per turn in "new_words" (may be empty).
Respond ONLY with JSON, no markdown fences:
{"reply":"Spanish reply","hint":"English translation of reply","gloss":{"each word of your reply, lowercase, no punctuation":"short English meaning as used here"},"correction":{"you_said":"","better":"","why":""} OR null,"new_words":[{"es":"","en":"","example":"short Spanish example"}]}
The "gloss" must cover every word in "reply" (and in any example sentences), so a pure beginner can tap any word to see its meaning.`;
}

/* ---------- Mensajes: contacts who text you first, like real friends ---------- */
const CONTACTS = [
  { id: "mateo", emoji: "☕", name: "Mateo", about: "tu amigo de Buenos Aires", topics: "plans to hang out, something that happened to him, checking in on your life" },
  { id: "rosa", emoji: "🍊", name: "Doña Rosa", about: "la vendedora del mercado", topics: "new fruit that just came in, a discount, asking how you're doing" },
  { id: "lucia", emoji: "🗺️", name: "Lucía", about: "la madrileña que conociste en la calle", topics: "meeting up for coffee, asking if you got somewhere okay" },
  { id: "camila", emoji: "🌙", name: "Camila", about: "tu amiga que siempre pregunta por tu día", topics: "asking how your day went, sharing something from her day, sending encouragement" },
  { id: "diego", emoji: "🎉", name: "Diego", about: "tu amigo que siempre tiene planes", topics: "inviting you to something this weekend, telling you about a plan" },
];

function buildContactSystemPrompt(c) {
  return `You are ${c.name} (${c.about}), texting your friend — a BEGINNER Spanish learner (A1–A2) — over something like WhatsApp. You text about things like: ${c.topics}.
Rules:
- Write like a real informal text message: short (1-2 sentences), warm, simple Spanish. Emoji are welcome (0-1 per message) but don't overdo it.
- The learner's replies may be typed or dictated (imperfect speech recognition) — be forgiving of odd phrasing and guess the intended meaning.
- Keep the thread going naturally; don't just greet on loop.
- If the learner makes a clear language error (not just casual texting style), you may gently recast it in "correction" — keep it light, this is texting, not a lesson. Otherwise null.
- Introduce at most 1 useful new word/phrase per message in "new_words" (may be empty).
Respond ONLY with JSON, no markdown fences:
{"reply":"your text message in Spanish","hint":"English translation","gloss":{"each word of your reply, lowercase, no punctuation":"short English meaning as used here"},"correction":{"you_said":"","better":"","why":""} OR null,"new_words":[{"es":"","en":"","example":"short Spanish example"}]}
The "gloss" must cover every word in "reply" so a pure beginner can tap any word to see its meaning.`;
}

const OPENER_META = "\n\n(Meta: this is the FIRST message of a brand-new conversation — you're texting out of the blue about one of your usual topics. Don't send a generic greeting-and-wait; get into something real in 1-2 short sentences, like a real opening text.)";

const initialDue = () => Date.now() + (6 * 3600000 + Math.random() * 18 * 3600000); // first text within 6-24h
const nextInterval = () => Date.now() + (24 * 3600000 + Math.random() * 3 * dayMs); // 1-4 days later

async function askAI(messages) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status})`);
  return (data.text || "").replace(/```json|```/g, "").trim();
}

async function loadKey(key, fallback) {
  try { const raw = localStorage.getItem("charla:" + key); return raw != null ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
async function saveKey(key, val) {
  try { localStorage.setItem("charla:" + key, JSON.stringify(val)); } catch (e) { console.error("save failed", e); }
}

function AppInner({ user, logout }) {
  const [tab, setTab] = useState("hablar");
  const [words, setWords] = useState([]);
  const [reflections, setReflections] = useState([]);
  const [customScenes, setCustomScenes] = useState([]);
  const [gloss, setGloss] = useState(BASE_GLOSS);
  const [loaded, setLoaded] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(() => localStorage.getItem("charla:privacyNoteDismissed") !== "1");
  const [pendingOpenId, setPendingOpenId] = useState(null);
  const [threads, setThreads] = useState({});
  const threadsRef = useRef({});
  const { en: englishMode, flash: flashEnglish } = useUI();
  const t = useT();

  const dismissPrivacy = () => {
    localStorage.setItem("charla:privacyNoteDismissed", "1");
    setShowPrivacy(false);
  };

  useEffect(() => {
    (async () => {
      setWords(await loadKey("palabras", []));
      setReflections(await loadKey("reflexiones", []));
      setCustomScenes(await loadKey("escenas", []));
      const g = await loadKey("glosario", {});
      setGloss(prev => ({ ...prev, ...g }));
      const saved = await loadKey("hilos", {});
      const withDefaults = { ...saved };
      CONTACTS.forEach(c => { if (!withDefaults[c.id]) withDefaults[c.id] = { msgs: [], apiHistory: [], unread: false, nextDue: initialDue(), generating: false }; });
      threadsRef.current = withDefaults;
      setThreads(withDefaults);
      saveKey("hilos", withDefaults);
      setLoaded(true);
    })();
    return hush;
  }, []);

  const mergeGloss = useCallback((add) => {
    setGloss(prev => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(add || {})) {
        const key = strip(k);
        if (key && typeof v === "string" && v.trim()) next[key] = v.trim().toLowerCase();
      }
      saveKey("glosario", next);
      return next;
    });
  }, []);

  // One LLM call per due contact — never parallel, to stay gentle on the free Gemini tier.
  const updateThread = useCallback((id, patch) => {
    const next = { ...threadsRef.current, [id]: { ...threadsRef.current[id], ...patch } };
    threadsRef.current = next;
    setThreads(next);
    saveKey("hilos", next);
  }, []);

  const checkDue = useCallback(async () => {
    for (const c of CONTACTS) {
      const th = threadsRef.current[c.id];
      if (!th || th.generating || th.nextDue > Date.now()) continue;
      updateThread(c.id, { generating: true });
      try {
        const raw = await askAI([{ role: "user", content: buildContactSystemPrompt(c) + OPENER_META }]);
        let p; try { p = JSON.parse(raw); } catch { p = { reply: raw, hint: null, gloss: {}, new_words: [] }; }
        if (p.gloss && typeof p.gloss === "object") mergeGloss(p.gloss);
        const base = threadsRef.current[c.id];
        if (base.apiHistory.length > 0) {
          // the user already started this conversation themselves while the opener was generating — don't clobber it
          updateThread(c.id, { generating: false, nextDue: nextInterval() });
        } else {
          updateThread(c.id, {
            msgs: [...base.msgs, { role: "them", es: p.reply, hint: p.hint, correction: null, new_words: p.new_words || [], ts: Date.now() }],
            apiHistory: [{ role: "user", content: buildContactSystemPrompt(c) }, { role: "assistant", content: raw }],
            unread: true,
            nextDue: nextInterval(),
            generating: false,
          });
        }
      } catch {
        updateThread(c.id, { generating: false }); // nextDue is untouched, so this naturally retries on the next check
      }
    }
  }, [mergeGloss, updateThread]);

  useEffect(() => { if (loaded) checkDue(); }, [loaded]); // eslint-disable-line

  const unreadCount = Object.values(threads).filter(th => th.unread).length;

  const lookupWord = useCallback(async (word, context) => {
    try {
      const raw = await askAI([{ role: "user", content: `In the Spanish sentence "${context}", what does the word "${word}" mean in English? Reply with ONLY the short English equivalent (1-4 words), no punctuation, nothing else.` }]);
      const en = raw.split("\n")[0].replace(/["'.]/g, "").trim();
      if (en && en.length < 40) mergeGloss({ [word]: en });
    } catch {}
  }, [mergeGloss]);

  const persistWords = n => { setWords(n); saveKey("palabras", n); };
  const persistReflections = n => { setReflections(n); saveKey("reflexiones", n); };
  const persistScenes = n => { setCustomScenes(n); saveKey("escenas", n); };
  const dueCount = words.filter(w => w.due <= Date.now()).length;

  return (
    <div className="app">
      <style>{css}</style>
      <header className="top">
        <div className="brand">Charla<span className="dot">.</span></div>
        <div className="tag"><TapPhrase es="habla primero, teclea después" en="speak first, type later" /></div>
        <button className={"enToggle " + (englishMode ? "on" : "")} onClick={flashEnglish} title={t("Ver todo en inglés por 5 segundos", "Show everything in English for 5 seconds")}>EN</button>
        <button className="profileChip" onClick={logout} title={t("Cerrar sesión", "Sign out")}>
          {user.picture ? <img src={user.picture} alt="" className="profileAvatar" /> : <span className="profileAvatar profileAvatarFallback">{(user.name || user.email)[0].toUpperCase()}</span>}
        </button>
      </header>
      {showPrivacy && (
        <div className="privacyNote">
          <span>Charla runs on Google's free Gemini API tier. Conversations and photos you scan may be used by Google to improve their models — don't share anything sensitive.</span>
          <button className="privacyClose" onClick={dismissPrivacy}>✕</button>
        </div>
      )}
      <main className="main">
        {!loaded ? <div className="loading">{t("Cargando…", "Loading…")}</div> :
          tab === "hablar" ? <Hablar words={words} persistWords={persistWords} persistReflections={persistReflections} reflections={reflections} goReflect={(id) => { setPendingOpenId(id); setTab("reflexion"); }} gloss={gloss} mergeGloss={mergeGloss} lookupWord={lookupWord} customScenes={customScenes} persistScenes={persistScenes} /> :
          tab === "repasar" ? <Repasar words={words} persistWords={persistWords} gloss={gloss} lookupWord={lookupWord} /> :
          tab === "mensajes" ? <Mensajes contacts={CONTACTS} threads={threads} updateThread={updateThread} words={words} persistWords={persistWords} gloss={gloss} mergeGloss={mergeGloss} lookupWord={lookupWord} /> :
          <Reflexion reflections={reflections} persistReflections={persistReflections} gloss={gloss} lookupWord={lookupWord} openId={pendingOpenId} onOpened={() => setPendingOpenId(null)} />}
      </main>
      <nav className="nav">
        {[["hablar", "🎙️", t("Hablar", "Talk")], ["mensajes", "💬", t("Mensajes", "Messages"), unreadCount], ["repasar", "🃏", t("Repasar", "Review"), dueCount], ["reflexion", "📓", t("Reflexión", "Reflection")]].map(([id, icon, label, badge]) => (
          <button key={id} className={"navBtn " + (tab === id ? "on" : "")} onClick={() => { hush(); setTab(id); if (id === "mensajes") checkDue(); }}>
            <span className="navIcon">{icon}{badge > 0 && <span className="badge">{badge}</span>}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
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

function LoginScreen() {
  return (
    <div className="app">
      <style>{css}</style>
      <div className="loginWrap">
        <div className="loginCard">
          <div className="brand">Charla<span className="dot">.</span></div>
          <p className="sub">Habla de verdad. Sign in to save your progress and keep it across devices.</p>
          <a className="googleBtn" href="/api/auth/google"><GoogleIcon /> Sign in with Google</a>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [englishMode, setEnglishMode] = useState(false);
  const timerRef = useRef(null);
  const flash = useCallback(() => {
    setEnglishMode(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setEnglishMode(false), 5000);
  }, []);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) setUser((await res.json()).user);
      } catch {}
      setAuthChecked(true);
    })();
  }, []);

  const logout = useCallback(async () => {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    setUser(null);
  }, []);

  return (
    <UIContext.Provider value={{ en: englishMode, flash }}>
      {!authChecked ? <div className="loading">Cargando…</div> :
        !user ? <LoginScreen /> :
        <AppInner user={user} logout={logout} />}
    </UIContext.Provider>
  );
}

/* ==================== HABLAR ==================== */
function Hablar({ words, persistWords, persistReflections, reflections, goReflect, gloss, mergeGloss, lookupWord, customScenes, persistScenes }) {
  const t = useT();
  const { en: globalEn } = useUI();
  const [scenario, setScenario] = useState(() => loadSync("sesionActiva", null)?.scenario || null);
  const [msgs, setMsgs] = useState(() => loadSync("sesionActiva", null)?.msgs || []);
  const [apiHistory, setApiHistory] = useState(() => loadSync("sesionActiva", null)?.apiHistory || []);
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState(false);
  const [needMore, setNeedMore] = useState(false);
  const [typeMode, setTypeMode] = useState(false);
  const [input, setInput] = useState("");
  const [ideaText, setIdeaText] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);
  const [help, setHelp] = useState(null);
  const [helpBusy, setHelpBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  useEffect(() => () => hush(), []);

  // Keep the active conversation durable across a refresh, a tab switch, or an accidental close.
  useEffect(() => {
    saveKey("sesionActiva", scenario ? { scenario, msgs, apiHistory } : null);
  }, [scenario, msgs, apiHistory]);

  const send = useCallback(async (text) => {
    text = text.trim();
    if (!text) return;
    setHelp(null);
    setMsgs(m => [...m, { role: "me", es: text }]);
    setBusy(true);
    setApiHistory(prev => {
      const hist = [...prev, { role: "user", content: text }];
      (async () => {
        try {
          const raw = await askAI(hist);
          let p; try { p = JSON.parse(raw); } catch { p = { reply: raw, hint: null, correction: null, new_words: [] }; }
          setMsgs(m => [...m, { role: "ai", es: p.reply, hint: p.hint, correction: p.correction, new_words: p.new_words || [] }]);
          setApiHistory(h => [...h, { role: "assistant", content: raw }]);
          if (p.gloss && typeof p.gloss === "object") mergeGloss(p.gloss);
          speak(p.reply);
        } catch {
          setMsgs(m => [...m, { role: "ai", es: t("(No pude responder — revisa tu conexión e inténtalo otra vez.)", "(Couldn't reply — check your connection and try again.)"), error: true }]);
        }
        setBusy(false);
      })();
      return hist;
    });
  }, [mergeGloss, t]);

  const retryLast = useCallback(async () => {
    setBusy(true);
    try {
      const raw = await askAI(apiHistory);
      let p; try { p = JSON.parse(raw); } catch { p = { reply: raw, hint: null, correction: null, new_words: [] }; }
      setMsgs(m => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "ai", es: p.reply, hint: p.hint, correction: p.correction, new_words: p.new_words || [] };
        return copy;
      });
      setApiHistory(h => [...h, { role: "assistant", content: raw }]);
      if (p.gloss && typeof p.gloss === "object") mergeGloss(p.gloss);
      speak(p.reply);
    } catch {
      // leave the error bubble in place — the retry button stays available
    }
    setBusy(false);
  }, [apiHistory, mergeGloss]);

  const mic = useMic(send);

  const start = (sc) => {
    setScenario(sc);
    setHelp(null);
    setMsgs([{ role: "ai", es: sc.opener, hint: sc.hint, correction: null, new_words: [] }]);
    setApiHistory([
      { role: "user", content: buildSystemPrompt(sc) },
      { role: "assistant", content: JSON.stringify({ reply: sc.opener, hint: "", correction: null, new_words: [] }) },
    ]);
    speak(sc.opener); // scenario tap = user gesture, unlocks audio on iOS
  };

  const leave = () => { hush(); mic.stop(); setScenario(null); setMsgs([]); setApiHistory([]); };

  const saveWord = (w) => {
    if (words.some(x => strip(x.es) === strip(w.es))) return;
    persistWords([...words, { ...w, due: Date.now(), interval: 0, reps: 0, added: Date.now() }]);
  };

  const endSession = async () => {
    if (msgs.length < 3 || busy) return;
    hush(); mic.stop();
    setBusy(true); setEnding(true); setEndError(false);
    try {
      const transcript = msgs.map(m => (m.role === "me" ? "Learner: " : "Partner: ") + m.es).join("\n");
      const raw = await askAI([{
        role: "user",
        content: `A beginner Spanish learner just finished this spoken practice conversation:\n${transcript}\n\nCreate a short reflection. Respond ONLY with JSON, no fences:\n{"summary":"1 warm sentence in English about what they did","can_now_say":["2-3 Spanish phrases they used or learned"],"questions":["2 short reflection questions in English about what was hard / what they'd say differently"]}`,
      }]);
      let p; try { p = JSON.parse(raw); } catch { p = { summary: "You held a real spoken conversation in Spanish.", can_now_say: [], questions: ["What was the hardest moment to say out loud?", "What would you say differently next time?"] }; }
      const id = Date.now();
      persistReflections([{ id, date: new Date().toLocaleDateString(), scenario: scenario.title, sceneTitleEn: scenario.titleEn || scenario.title_en || scenario.goal, transcript: msgs, ...p, note: "" }, ...reflections]);
      leave();
      goReflect(id);
    } catch {
      setEndError(true);
    }
    setBusy(false); setEnding(false);
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
        content: `Create a Spanish conversation practice scenario for a BEGINNER (A1-A2) from this idea: "${idea}". Make it a meaningful conversation with a clear goal, not small talk. Respond ONLY with JSON, no fences:\n{"emoji":"one emoji","title":"short Spanish title (2-4 words)","title_en":"English translation of the title","goal":"one-line goal in English","who":"character name + one-line description in English","opener":"the character's first line in simple Spanish, max 2 short sentences, ending with a question","hint":"English translation of the opener"}`,
      }]);
      const p = JSON.parse(raw);
      persistScenes([...customScenes, { id: "custom-" + Date.now(), custom: true, ...p }]);
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
        content: `(Meta request — do NOT continue the conversation. The learner is stuck on how to answer your last message. Respond ONLY with JSON, no fences:\n{"starters":["2 short Spanish sentence starters they could begin with"],"example":"one full, simple example answer in Spanish","example_en":"English translation of the example"})`,
      }]);
      const p = JSON.parse(raw);
      setHelp({ stage: "hint", ...p });
    } catch (e) {
      setHelp({ stage: "hint", starters: [], error: e.message || "Couldn't get help — try again." });
    }
    setHelpBusy(false);
  };

  if (!scenario) return (
    <div className="pad">
      <h1 className="display"><TapPhrase es={<>Habla <em>de verdad</em>.</>} en="Speak for real." /></h1>
      <p className="sub">Pick a scene, then just talk — your partner speaks back, keeps it simple, and keeps it going. No "hola, ¿cómo estás?" on loop.</p>
      {!SR && <div className="warn">🎙️ Voice input isn't supported in this browser — you'll get a keyboard instead, and replies are still spoken aloud. Chrome or Safari work best.</div>}
      <div className="scenes">
        {[...SCENARIOS, ...customScenes].map(sc => (
          <button key={sc.id} className="scene" onClick={() => start(sc)}>
            <span className="sceneEmoji">{sc.emoji}</span>
            <span className="sceneBody">
              <span className="sceneTitle"><TapPhrase es={sc.title} en={sc.titleEn || sc.title_en || sc.goal} /></span>
              <span className="sceneGoal">{sc.goal}</span>
              <span className="sceneWho">with {sc.who}</span>
            </span>
            {sc.custom && <span className="sceneDel" onClick={(e) => { e.stopPropagation(); persistScenes(customScenes.filter(x => x.id !== sc.id)); }}>✕</span>}
          </button>
        ))}
        <div className="creator">
          <div className="creatorTitle">🎬 {t("Crea tu escena", "Create your scene")}</div>
          <div className="creatorSub">Share the core idea — Charla builds the character, goal and opening line.</div>
          <div className="creatorRow">
            <input value={ideaText} onChange={e => setIdeaText(e.target.value)}
                   onKeyDown={e => e.key === "Enter" && createScene()}
                   placeholder={'e.g. "job interview at a bakery"'} />
            <button className="sendBtn" onClick={createScene} disabled={creating || !ideaText.trim()}>{creating ? "…" : "✨"}</button>
          </div>
          {createError && <div className="creatorError">{t("No pude crear esa escena — inténtalo otra vez.", "Couldn't create that scene — try again.")}</div>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="chatWrap">
      <div className="chatHead">
        <button className="ghost" onClick={leave}>←</button>
        <div>
          <div className="chatTitle">{scenario.emoji} <TapPhrase es={scenario.title} en={scenario.titleEn || scenario.title_en || scenario.goal} /></div>
          <div className="chatGoal">Goal: {scenario.goal}</div>
        </div>
        <button className="endBtn" onClick={tryEnd} disabled={busy}>{ending ? "…" : t("Terminar ✓", "Finish ✓")}</button>
      </div>
      {needMore && <div className="needMoreNote">{t("Sigue hablando un poco más antes de terminar.", "Chat a little more before finishing.")}</div>}
      {endError && <div className="needMoreNote err">{t("No pude guardar la reflexión — inténtalo otra vez.", "Couldn't save the reflection — try again.")}</div>}

      <div className="msgs">
        {msgs.map((m, i) => (
          <div key={i} className={"row " + m.role}>
            <div className={"bubble " + m.role + (m.error ? " err" : "")}>
              <div>{m.role === "ai" && !m.error ? <TapText text={m.es} gloss={gloss} lookup={lookupWord} showAll={m.showAllGloss} /> : m.es}</div>
              {m.role === "ai" && !m.error && (
                <div className="bubbleTools">
                  <button className="tool" onClick={(e) => { e.stopPropagation(); speak(m.es); }}>🔊</button>
                  <button className="tool" onClick={(e) => { e.stopPropagation(); speak(m.es, 0.65); }}>🐢</button>
                  <button className="tool" onClick={(e) => { e.stopPropagation(); setMsgs(ms => ms.map((x, j) => j === i ? { ...x, showAllGloss: !x.showAllGloss } : x)); }}>
                    💡 {m.showAllGloss ? t("ocultar", "hide") : t("pista", "hint")}
                  </button>
                  {m.hint && (
                    <button className="tool hintTool" onClick={(e) => { e.stopPropagation(); setMsgs(ms => ms.map((x, j) => j === i ? { ...x, showHint: !x.showHint } : x)); }}>
                      {m.showHint ? t("ocultar EN", "hide EN") : t("revelar EN", "show EN")}
                    </button>
                  )}
                </div>
              )}
              {m.error && i === msgs.length - 1 && (
                <button className="tool" onClick={retryLast} disabled={busy}>↻ {t("Reintentar", "Retry")}</button>
              )}
              {(m.showHint || globalEn) && m.hint && <div className="hintText">{m.hint}</div>}
            </div>
            {m.correction && (
              <div className="correction">
                <span className="corrLabel">{t("Mejor:", "Better:")}</span> <s><TapText text={m.correction.you_said} gloss={gloss} lookup={lookupWord} /></s> → <b><TapText text={m.correction.better} gloss={gloss} lookup={lookupWord} /></b> <span className="spk" onClick={() => speak(m.correction.better)}>🔊</span>
                <div className="corrWhy">{m.correction.why}</div>
              </div>
            )}
            {m.new_words?.length > 0 && (
              <div className="chips">
                {m.new_words.map((w, k) => {
                  const saved = words.some(x => strip(x.es) === strip(w.es));
                  return (
                    <button key={k} className={"chip " + (saved ? "saved" : "")}
                            onClick={() => { speak(w.es); saveWord(w); }}>
                      <b>{w.es}</b> · {w.en} {saved ? "✓" : "＋"}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {busy && !ending && <div className="row ai"><div className="bubble ai typing">● ● ●</div></div>}
        <div ref={endRef} />
      </div>

      {/* Audio-first composer */}
      <div className="talkBar">
        {help && (
          <div className="helpCard">
            <button className="helpClose" onClick={() => setHelp(null)}>✕</button>
            <div className="cardLabel">{t("Cómo responder", "How to answer")}</div>
            {help.error && <div className="helpError">{help.error}</div>}
            {help.starters?.map((s, i) => (
              <div key={i} className="starter">“<TapText text={s} gloss={gloss} lookup={lookupWord} />…” <span className="spk" onClick={() => speak(s)}>🔊</span></div>
            ))}
            {help.error ? null : help.stage === "hint" ? (
              <button className="pistaBtn wide" onClick={() => setHelp(h => ({ ...h, stage: "full" }))}>{t("Revelar una respuesta completa", "Reveal a full answer")}</button>
            ) : (
              <div className="helpFull">
                “<TapText text={help.example} gloss={gloss} lookup={lookupWord} />” <span className="spk" onClick={() => speak(help.example, 0.85)}>🔊</span>
                <div className="helpEn">{help.example_en}</div>
              </div>
            )}
          </div>
        )}
        {typeMode || !mic.supported ? (
          <div className="typeRow">
            <button className="ghost" onClick={getHelp} disabled={helpBusy || busy} title="Help me answer">🙋</button>
            <input value={input} onChange={e => setInput(e.target.value)}
                   onKeyDown={e => { if (e.key === "Enter" && input.trim() && !busy) { send(input); setInput(""); } }}
                   placeholder={t("Escribe en español…", "Write in Spanish…")} autoFocus />
            <button className="sendBtn" disabled={busy || !input.trim()} onClick={() => { send(input); setInput(""); }}>➤</button>
            {mic.supported && <button className="ghost" onClick={() => setTypeMode(false)}>🎙️</button>}
          </div>
        ) : (
          <>
            <div className={"liveText" + (mic.error ? " err" : "")}>
              {mic.error ? mic.error : helpBusy ? t("Buscando ayuda…", "Finding help…") : mic.listening ? (mic.interim || t("Te escucho…", "I'm listening…")) : busy ? t("Pensando…", "Thinking…") : t("Toca y habla", "Tap and talk")}
            </div>
            <div className="talkRow">
              <button className="sideTool" onClick={getHelp} disabled={helpBusy || busy} title="Help me answer">🙋</button>
              <button className={"talkBtn " + (mic.listening ? "live" : "")} disabled={busy}
                      onClick={() => (mic.listening ? mic.stop() : mic.start())}>
                {mic.listening ? "◼" : "🎙️"}
              </button>
              <button className="sideTool" onClick={() => setTypeMode(true)} title="Type instead">⌨️</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ==================== MENSAJES — contacts who text you first ==================== */
function Mensajes({ contacts, threads, updateThread, words, persistWords, gloss, mergeGloss, lookupWord }) {
  const t = useT();
  const [openId, setOpenId] = useState(null);

  if (openId) {
    const contact = contacts.find(c => c.id === openId);
    return (
      <ContactThread contact={contact} thread={threads[openId]} updateThread={updateThread}
                     onBack={() => setOpenId(null)} words={words} persistWords={persistWords}
                     gloss={gloss} mergeGloss={mergeGloss} lookupWord={lookupWord} />
    );
  }

  return (
    <div className="pad">
      <h1 className="display"><TapPhrase es="Mensajes" en="Messages" /></h1>
      <p className="sub">Your contacts text you like real life — reply whenever, in Spanish.</p>
      <div className="contactList">
        {contacts.map(c => {
          const th = threads[c.id];
          const last = th?.msgs?.[th.msgs.length - 1];
          return (
            <button key={c.id} className="contactRow" onClick={() => { setOpenId(c.id); if (th?.unread) updateThread(c.id, { unread: false }); }}>
              <span className="contactEmoji">{c.emoji}</span>
              <span className="contactBody">
                <span className="contactName">{c.name}{th?.unread && <span className="unreadDot" />}</span>
                <span className="contactPreview dim">
                  {last ? (last.role === "me" ? t("Tú: ", "You: ") : "") + last.es : t("Sin mensajes todavía", "No messages yet")}
                </span>
              </span>
              {last?.ts && <span className="contactTime dim">{new Date(last.ts).toLocaleDateString()}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ContactThread({ contact, thread, updateThread, onBack, words, persistWords, gloss, mergeGloss, lookupWord }) {
  const t = useT();
  const { en: globalEn } = useUI();
  const [busy, setBusy] = useState(false);
  const [typeMode, setTypeMode] = useState(false);
  const [input, setInput] = useState("");
  const endRef = useRef(null);
  const msgs = thread?.msgs || [];
  const apiHistory = thread?.apiHistory || [];

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  const send = useCallback(async (text) => {
    text = text.trim();
    if (!text) return;
    const withMe = [...msgs, { role: "me", es: text, ts: Date.now() }];
    updateThread(contact.id, { msgs: withMe });
    setBusy(true);
    // A thread can be opened before the contact has ever texted first (apiHistory still empty) —
    // fold the persona instructions into this first turn so the model replies in character.
    const content = apiHistory.length === 0
      ? buildContactSystemPrompt(contact) + `\n\n(The learner just texted you first. Their message: "${text}")`
      : text;
    const hist = [...apiHistory, { role: "user", content }];
    updateThread(contact.id, { apiHistory: hist });
    try {
      const raw = await askAI(hist);
      let p; try { p = JSON.parse(raw); } catch { p = { reply: raw, hint: null, correction: null, new_words: [] }; }
      updateThread(contact.id, {
        msgs: [...withMe, { role: "them", es: p.reply, hint: p.hint, correction: p.correction, new_words: p.new_words || [], ts: Date.now() }],
        apiHistory: [...hist, { role: "assistant", content: raw }],
      });
      if (p.gloss && typeof p.gloss === "object") mergeGloss(p.gloss);
    } catch {
      updateThread(contact.id, {
        msgs: [...withMe, { role: "them", es: t("(No pude responder — revisa tu conexión e inténtalo otra vez.)", "(Couldn't reply — check your connection and try again.)"), error: true, ts: Date.now() }],
      });
    }
    setBusy(false);
  }, [msgs, apiHistory, contact, updateThread, mergeGloss, t]);

  const retryLast = useCallback(async () => {
    setBusy(true);
    try {
      const raw = await askAI(apiHistory);
      let p; try { p = JSON.parse(raw); } catch { p = { reply: raw, hint: null, correction: null, new_words: [] }; }
      const copy = [...msgs];
      copy[copy.length - 1] = { role: "them", es: p.reply, hint: p.hint, correction: p.correction, new_words: p.new_words || [], ts: Date.now() };
      updateThread(contact.id, { msgs: copy, apiHistory: [...apiHistory, { role: "assistant", content: raw }] });
      if (p.gloss && typeof p.gloss === "object") mergeGloss(p.gloss);
    } catch {
      // leave the error bubble in place — the retry button stays available
    }
    setBusy(false);
  }, [apiHistory, msgs, contact, updateThread, mergeGloss]);

  const mic = useMic(send);

  const saveWord = (w) => {
    if (words.some(x => strip(x.es) === strip(w.es))) return;
    persistWords([...words, { ...w, due: Date.now(), interval: 0, reps: 0, added: Date.now() }]);
  };

  const toggleGloss = (i) => updateThread(contact.id, { msgs: msgs.map((x, j) => j === i ? { ...x, showAllGloss: !x.showAllGloss } : x) });
  const toggleHint = (i) => updateThread(contact.id, { msgs: msgs.map((x, j) => j === i ? { ...x, showHint: !x.showHint } : x) });

  return (
    <div className="chatWrap">
      <div className="chatHead">
        <button className="ghost" onClick={onBack}>←</button>
        <div>
          <div className="chatTitle">{contact.emoji} {contact.name}</div>
          <div className="chatGoal">{contact.about}</div>
        </div>
      </div>

      <div className="msgs">
        {msgs.map((m, i) => (
          <div key={i} className={"row " + (m.role === "me" ? "me" : "ai")}>
            <div className={"bubble " + (m.role === "me" ? "me" : "ai") + (m.error ? " err" : "")}>
              <div>{m.role !== "me" && !m.error ? <TapText text={m.es} gloss={gloss} lookup={lookupWord} showAll={m.showAllGloss} /> : m.es}</div>
              {m.role !== "me" && !m.error && (
                <div className="bubbleTools">
                  <button className="tool" onClick={(e) => { e.stopPropagation(); speak(m.es); }}>🔊</button>
                  <button className="tool" onClick={(e) => { e.stopPropagation(); speak(m.es, 0.65); }}>🐢</button>
                  <button className="tool" onClick={(e) => { e.stopPropagation(); toggleGloss(i); }}>
                    💡 {m.showAllGloss ? t("ocultar", "hide") : t("pista", "hint")}
                  </button>
                  {m.hint && (
                    <button className="tool hintTool" onClick={(e) => { e.stopPropagation(); toggleHint(i); }}>
                      {m.showHint ? t("ocultar EN", "hide EN") : t("revelar EN", "show EN")}
                    </button>
                  )}
                </div>
              )}
              {m.error && i === msgs.length - 1 && (
                <button className="tool" onClick={retryLast} disabled={busy}>↻ {t("Reintentar", "Retry")}</button>
              )}
              {(m.showHint || globalEn) && m.hint && <div className="hintText">{m.hint}</div>}
            </div>
            {m.correction && (
              <div className="correction">
                <span className="corrLabel">{t("Mejor:", "Better:")}</span> <s><TapText text={m.correction.you_said} gloss={gloss} lookup={lookupWord} /></s> → <b><TapText text={m.correction.better} gloss={gloss} lookup={lookupWord} /></b> <span className="spk" onClick={() => speak(m.correction.better)}>🔊</span>
                <div className="corrWhy">{m.correction.why}</div>
              </div>
            )}
            {m.new_words?.length > 0 && (
              <div className="chips">
                {m.new_words.map((w, k) => {
                  const saved = words.some(x => strip(x.es) === strip(w.es));
                  return (
                    <button key={k} className={"chip " + (saved ? "saved" : "")}
                            onClick={() => { speak(w.es); saveWord(w); }}>
                      <b>{w.es}</b> · {w.en} {saved ? "✓" : "＋"}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="row ai"><div className="bubble ai typing">● ● ●</div></div>}
        <div ref={endRef} />
      </div>

      <div className="talkBar">
        {typeMode || !mic.supported ? (
          <div className="typeRow">
            <input value={input} onChange={e => setInput(e.target.value)}
                   onKeyDown={e => { if (e.key === "Enter" && input.trim() && !busy) { send(input); setInput(""); } }}
                   placeholder={t("Escribe en español…", "Write in Spanish…")} autoFocus />
            <button className="sendBtn" disabled={busy || !input.trim()} onClick={() => { send(input); setInput(""); }}>➤</button>
            {mic.supported && <button className="ghost" onClick={() => setTypeMode(false)}>🎙️</button>}
          </div>
        ) : (
          <>
            <div className={"liveText" + (mic.error ? " err" : "")}>
              {mic.error ? mic.error : mic.listening ? (mic.interim || t("Te escucho…", "I'm listening…")) : busy ? t("Pensando…", "Thinking…") : t("Toca y habla", "Tap and talk")}
            </div>
            <div className="talkRow">
              <button className={"talkBtn " + (mic.listening ? "live" : "")} disabled={busy}
                      onClick={() => (mic.listening ? mic.stop() : mic.start())}>
                {mic.listening ? "◼" : "🎙️"}
              </button>
              <button className="sideTool" onClick={() => setTypeMode(true)} title="Type instead">⌨️</button>
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

function Repasar({ words, persistWords, gloss, lookupWord }) {
  const t = useT();
  const [queue, setQueue] = useState(null);
  const [idx, setIdx] = useState(0);
  const [attempt, setAttempt] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [showPista, setShowPista] = useState(false);
  const [done, setDone] = useState(0);
  const [mnBusy, setMnBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [add, setAdd] = useState({ es: "", en: "", example: "" });
  const [scan, setScan] = useState(null);
  const [lastDeleted, setLastDeleted] = useState(null);
  const [lastGrade, setLastGrade] = useState(null);
  const fileRef = useRef(null);
  const deleteTimerRef = useRef(null);
  const gradeTimerRef = useRef(null);

  useEffect(() => () => { clearTimeout(deleteTimerRef.current); clearTimeout(gradeTimerRef.current); }, []);

  const due = words.filter(w => w.due <= Date.now());
  const current = queue ? words.find(w => w.es === queue[idx]) : null;
  const mode = current ? (current.reps % 2 === 1 ? "listen" : "produce") : "produce";

  const onSpoken = useCallback((text) => setAttempt(text), []);
  const mic = useMic(onSpoken);

  useEffect(() => () => { hush(); }, []);
  useEffect(() => { if (current && mode === "listen" && !revealed) speak(current.es, 0.9); }, [idx, queue]); // eslint-disable-line

  const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const startSession = (list) => { setQueue(shuffle(list).map(w => w.es)); setIdx(0); setAttempt(""); setRevealed(false); setShowPista(false); setDone(0); setLastGrade(null); };

  const reveal = () => { setRevealed(true); if (current) speak(current.es, 0.85); };

  const grade = (good) => {
    hush();
    const prevWord = current, prevQueue = queue, prevIdx = idx, prevDone = done;
    const next = words.map(w => {
      if (w.es !== current.es) return w;
      if (!good) return { ...w, interval: 0, due: Date.now() + 10 * 60000, reps: w.reps + 1 };
      const interval = w.interval === 0 ? 1 : Math.round(w.interval * 2.5);
      return { ...w, interval, due: Date.now() + interval * dayMs, reps: w.reps + 1 };
    });
    persistWords(next);
    setDone(d => d + 1);
    setLastGrade({ prevWord, prevQueue, prevIdx, prevDone });
    clearTimeout(gradeTimerRef.current);
    gradeTimerRef.current = setTimeout(() => setLastGrade(null), 6000);
    if (idx + 1 >= queue.length) setQueue(null);
    else { setIdx(idx + 1); setAttempt(""); setRevealed(false); setShowPista(false); }
  };

  const undoGrade = () => {
    if (!lastGrade) return;
    persistWords(words.map(w => w.es === lastGrade.prevWord.es ? lastGrade.prevWord : w));
    setQueue(lastGrade.prevQueue); setIdx(lastGrade.prevIdx); setDone(lastGrade.prevDone);
    setAttempt(""); setRevealed(true); setLastGrade(null);
  };

  const removeWord = (es) => {
    const w = words.find(x => x.es === es);
    persistWords(words.filter(x => x.es !== es));
    if (w) {
      setLastDeleted(w);
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setLastDeleted(null), 5000);
    }
  };

  const undoDelete = () => {
    if (!lastDeleted) return;
    persistWords([...words, lastDeleted]);
    setLastDeleted(null);
  };

  const addManual = () => {
    const es = add.es.trim(), en = add.en.trim();
    if (!es || !en) return;
    if (words.some(w => strip(w.es) === strip(es))) { setAdd({ es: "", en: "", example: "" }); return; }
    persistWords([...words, { es, en, example: add.example.trim(), due: Date.now(), interval: 0, reps: 0, added: Date.now(), manual: true }]);
    setAdd({ es: "", en: "", example: "" });
  };

  const getMnemonic = async () => {
    if (!current || mnBusy) return;
    setMnBusy(true);
    try {
      const raw = await askAI([{ role: "user", content: `Create a memorable mnemonic for an English speaker learning the Spanish word "${current.es}" (meaning: "${current.en}"). Use the keyword method: find an English word or phrase that SOUNDS like the Spanish, then link it to the meaning with one vivid, slightly absurd image. Max 2 short sentences, plain text, no preamble.` }]);
      const mnemonic = raw.trim().slice(0, 300);
      persistWords(words.map(w => w.es === current.es ? { ...w, mnemonic } : w));
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
          { type: "text", text: `This photo contains Spanish text (a sign, menu, message, page…). 1) Transcribe the Spanish exactly, fixing only obvious OCR errors. 2) Translate it to natural English. 3) Extract 3–8 useful words or short phrases for a BEGINNER, each with an English meaning and a short Spanish example. Respond ONLY with JSON, no fences:\n{"text":"","translation":"","words":[{"es":"","en":"","example":""}]}` },
        ],
      }]);
      const p = JSON.parse(raw);
      const fresh = (p.words || []).filter(w => w.es && w.en && !words.some(x => strip(x.es) === strip(w.es)));
      if (fresh.length) persistWords([...words, ...fresh.map(w => ({ ...w, due: Date.now(), interval: 0, reps: 0, added: Date.now(), scanned: true }))]);
      setScan({ text: p.text, translation: p.translation, words: p.words || [], added: fresh.map(w => w.es) });
    } catch { setScan({ error: true }); }
  };

  /* ---------- Session card ---------- */
  if (queue && current) {
    const match = attempt && (mode === "produce" ? strip(attempt).includes(strip(current.es)) : strip(current.en).split(/[\/,;]/).some(part => part.trim() && strip(attempt).includes(part.trim())));
    const blanked = current.example ? current.example.replace(new RegExp(current.es.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "＿＿＿") : null;
    const masked = current.es.split(" ").map(w => w[0] + " ·".repeat(Math.max(w.length - 1, 1))).join("   ");
    return (
      <div className="pad">
        <div className="progress">{idx + 1} / {queue.length} · {mode === "produce" ? "🗣️ say it in Spanish" : "👂 listen — what does it mean?"}</div>
        <div className="card">
          {mode === "produce" ? (
            <>
              <div className="cardLabel">Say the Spanish for…</div>
              <div className="cardEn">{current.en}</div>
              {blanked && <div className="cardEx">"<TapText text={blanked} gloss={gloss} lookup={lookupWord} />"</div>}
            </>
          ) : (
            <>
              <div className="cardLabel">Listen, then say the meaning</div>
              <button className="bigSpk" onClick={() => speak(current.es, 0.9)}>🔊</button>
              <button className="tool" onClick={() => speak(current.es, 0.6)}>🐢 slower</button>
            </>
          )}

          {!revealed ? (
            <>
              {mode === "produce" && mic.supported ? (
                <div className="talkRow center">
                  <button className={"talkBtn small " + (mic.listening ? "live" : "")} onClick={() => (mic.listening ? mic.stop() : mic.start())}>
                    {mic.listening ? "◼" : "🎙️"}
                  </button>
                </div>
              ) : (
                <input className="attempt" value={attempt} onChange={e => setAttempt(e.target.value)}
                       onKeyDown={e => e.key === "Enter" && reveal()}
                       placeholder={mode === "produce" ? "Type your attempt…" : "Type the English meaning…"} autoFocus />
              )}
              <div className={"liveText tall" + (mic.error ? " err" : "")}>
                {mic.error ? mic.error : mic.listening ? (mic.interim || t("Te escucho…", "I'm listening…")) : attempt ? `you said: “${attempt}”` : mode === "produce" && mic.supported ? "Say it out loud, then reveal" : ""}
              </div>
              {showPista && <div className="pistaMask">{mode === "produce" ? masked : current.es}</div>}
              <div className="revealRow">
                {!showPista && <button className="pistaBtn" onClick={() => setShowPista(true)}>💡 {t("Pista", "Hint")}</button>}
                <button className="cta inRow" onClick={reveal}>{t("Revelar", "Reveal")} 🔊</button>
              </div>
            </>
          ) : (
            <>
              <div className="veilAnswer">
                <div className="answerEs" onClick={() => speak(current.es, 0.85)}>{current.es} 🔊</div>
                <div className="answerEn">{current.en}</div>
                {current.example && <div className="answerEx">"<TapText text={current.example} gloss={gloss} lookup={lookupWord} />" <span className="spk" onClick={() => speak(current.example, 0.8)}>🔊</span></div>}
                {attempt && <div className={"attemptCheck " + (match ? "yes" : "")}>{match ? "✓ That's what you said!" : `you said: “${attempt}”`}</div>}
                {current.mnemonic
                  ? <div className="mnemo">🧠 {current.mnemonic}</div>
                  : <button className="tool" onClick={getMnemonic} disabled={mnBusy}>{mnBusy ? "…" : "🧠 " + t("Truco para recordar", "Memory trick")}</button>}
              </div>
              <div className="gradeRow">
                <button className="gradeBtn no" onClick={() => grade(false)}>{t("Otra vez", "Again")}<span>see again in 10 min</span></button>
                <button className="gradeBtn yes" onClick={() => grade(true)}>{t("¡La sabía!", "I knew it!")}<span>{current.interval === 0 ? "1 day" : Math.round(current.interval * 2.5) + " days"}</span></button>
              </div>
            </>
          )}
        </div>
        {lastGrade && (
          <button className="undoRow" onClick={undoGrade}>↺ {t("Deshacer calificación", "Undo grade")}</button>
        )}
      </div>
    );
  }

  /* ---------- Menu ---------- */
  return (
    <div className="pad">
      <h1 className="display"><TapPhrase es="Repaso hablado" en="Spoken review" /></h1>
      <p className="sub">
        {words.length === 0 ? "Save words from conversations, scan a photo, or add your own — then Charla brings them back right before you'd forget."
          : due.length > 0 ? t(`${due.length} palabra${due.length === 1 ? "" : "s"} lista${due.length === 1 ? "" : "s"} — dilas en voz alta antes de mirar.`, `${due.length} word${due.length === 1 ? "" : "s"} ready — say them out loud before you peek.`)
          : "Nothing due right now — you can still run through the whole deck."}
      </p>
      {done > 0 && <div className="doneNote">✓ Nice — {done} reviewed. Next reviews are scheduled.</div>}
      {lastGrade && (
        <div className="undoToast">
          <span>{t(`Calificaste: ${lastGrade.prevWord.es}`, `Graded: ${lastGrade.prevWord.es}`)}</span>
          <button onClick={undoGrade}>{t("Deshacer", "Undo")}</button>
        </div>
      )}
      {lastDeleted && (
        <div className="undoToast">
          <span>{t(`Eliminado: ${lastDeleted.es}`, `Deleted: ${lastDeleted.es}`)}</span>
          <button onClick={undoDelete}>{t("Deshacer", "Undo")}</button>
        </div>
      )}
      {words.length > 0 && (due.length > 0
        ? <button className="cta" onClick={() => startSession(due)}>{t("Empezar repaso", "Start review")}</button>
        : <button className="cta" onClick={() => startSession(words)}>{t("Practicar todas", "Practice all")}</button>)}

      <div className="toolCards">
        <div className="toolCard" onClick={() => fileRef.current?.click()}>
          <span className="toolEmoji">📷</span>
          <span><b>{t("Escanear texto", "Scan text")}</b><div className="dim">Photo a menu, sign or message → transcribe, translate, auto-save words</div></span>
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPickImage} />
        <div className="toolCard" onClick={() => setShowAdd(s => !s)}>
          <span className="toolEmoji">＋</span>
          <span><b>{t("Añadir palabra", "Add word")}</b><div className="dim">Add your own word or phrase to the deck</div></span>
        </div>
      </div>

      {showAdd && (
        <div className="addForm">
          <input value={add.es} onChange={e => setAdd({ ...add, es: e.target.value })} placeholder="Spanish word or phrase" />
          <input value={add.en} onChange={e => setAdd({ ...add, en: e.target.value })} placeholder="English meaning" />
          <input value={add.example} onChange={e => setAdd({ ...add, example: e.target.value })} onKeyDown={e => e.key === "Enter" && addManual()} placeholder="Example sentence (optional)" />
          <button className="cta small" onClick={addManual} disabled={!add.es.trim() || !add.en.trim()}>{t("Guardar en la baraja", "Save to deck")}</button>
        </div>
      )}

      {scan && (
        <div className="scanCard">
          <button className="helpClose" onClick={() => setScan(null)}>✕</button>
          {scan.busy ? <div className="dim">{t("Leyendo la foto…", "Reading the photo…")}</div>
            : scan.error ? (
              <div>
                <div className="dim">Couldn't read that image — try a sharper, closer photo.</div>
                <button className="tool" onClick={() => fileRef.current?.click()}>🔄 {t("Escanear otra vez", "Scan again")}</button>
              </div>
            )
            : (
              <>
                <div className="cardLabel">{t("Texto", "Text")}</div>
                <div className="scanText"><TapText text={scan.text} gloss={gloss} lookup={lookupWord} /> <span className="spk" onClick={() => speak(scan.text, 0.85)}>🔊</span></div>
                <div className="cardLabel">{t("Traducción", "Translation")}</div>
                <div className="scanTrans">{scan.translation}</div>
                <div className="cardLabel">{t("Palabras guardadas", "Saved words")}</div>
                {scan.words.map((w, i) => {
                  const inDeck = words.some(x => strip(x.es) === strip(w.es));
                  return (
                    <div key={i} className="deckRow">
                      <div><b>{w.es}</b> <span className="dim">· {w.en}</span></div>
                      {inDeck
                        ? <button className="miniBtn" onClick={() => removeWord(words.find(x => strip(x.es) === strip(w.es)).es)}>{t("quitar", "remove")}</button>
                        : <button className="miniBtn add" onClick={() => persistWords([...words, { ...w, due: Date.now(), interval: 0, reps: 0, added: Date.now(), scanned: true }])}>＋</button>}
                    </div>
                  );
                })}
                <button className="tool" onClick={() => fileRef.current?.click()}>🔄 {t("Escanear otra vez", "Scan again")}</button>
              </>
            )}
        </div>
      )}

      {words.length > 0 && (
        <>
          <div className="cardLabel deckHead">{t("Tu baraja", "Your deck")} · {words.length}</div>
          <div className="deckList">
            {[...words].sort((a, b) => a.due - b.due).map(w => (
              <div key={w.es} className="deckRow">
                <div onClick={() => speak(w.es)}><b>{w.es}</b> <span className="dim">· {w.en}</span> <span className="dim">🔊</span></div>
                <div className="deckRight">
                  <span className="dueTag">{w.due <= Date.now() ? "due now" : "in " + Math.max(1, Math.round((w.due - Date.now()) / dayMs)) + "d"}</span>
                  <button className="miniBtn" onClick={() => removeWord(w.es)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="howNote">
        <b>How the deck makes words stick:</b> spacing (gaps grow ~2.5× after each success), retrieval before reveal, cloze sentences, alternating directions (say it / hear it), shuffled order, and 🧠 keyword mnemonics on demand.
      </div>
    </div>
  );
}

/* ==================== REFLEXIÓN ==================== */
function Reflexion({ reflections, persistReflections, gloss, lookupWord, openId, onOpened }) {
  const t = useT();
  const [open, setOpen] = useState(null);
  const [notes, setNotes] = useState({});
  const [showTranscript, setShowTranscript] = useState({});

  useEffect(() => {
    const n = {}; reflections.forEach(r => { n[r.id] = r.note || ""; }); setNotes(n);
  }, [reflections]);

  useEffect(() => {
    if (openId) { setOpen(openId); onOpened?.(); }
  }, [openId]); // eslint-disable-line

  // Writes through the parent's persistReflections so the saved note isn't lost the
  // next time a new reflection is prepended from stale in-memory state.
  const saveNote = (id) => {
    persistReflections(reflections.map(r => r.id === id ? { ...r, note: notes[id] } : r));
    setOpen(null);
  };

  const deleteReflection = (id) => persistReflections(reflections.filter(r => r.id !== id));

  if (reflections.length === 0) return (
    <div className="pad center">
      <h1 className="display"><TapPhrase es="Reflexión" en="Reflection" /></h1>
      <p className="sub">After each conversation, tap "Terminar ✓" and Charla will show you what you can now say — and ask you two questions worth thinking about.</p>
    </div>
  );

  return (
    <div className="pad">
      <h1 className="display"><TapPhrase es="Reflexión" en="Reflection" /></h1>
      <p className="sub">Noticing your own progress is half the learning.</p>
      {reflections.map(r => (
        <div key={r.id} className="reflCard">
          <div className="reflHead" onClick={() => setOpen(open === r.id ? null : r.id)}>
            <div><b><TapPhrase es={r.scenario} en={r.sceneTitleEn || r.scenario} /></b><div className="dim">{r.date}</div></div>
            <span className="reflHeadRight">
              <span className="reflDel" onClick={(e) => { e.stopPropagation(); deleteReflection(r.id); }}>✕</span>
              <span>{open === r.id ? "−" : "+"}</span>
            </span>
          </div>
          {open === r.id && (
            <div className="reflBody">
              <p>{r.summary}</p>
              {r.can_now_say?.length > 0 && (
                <div className="canSay">
                  <div className="cardLabel">You can now say</div>
                  {r.can_now_say.map((s, i) => (
                    <div key={i} className="canSayItem">“<TapText text={s} gloss={gloss} lookup={lookupWord} />” <span className="spk" onClick={() => speak(s, 0.85)}>🔊</span></div>
                  ))}
                </div>
              )}
              <div className="cardLabel">Think about</div>
              {r.questions?.map((q, i) => <div key={i} className="reflQ">{q}</div>)}
              <textarea value={notes[r.id] || ""} onChange={e => setNotes({ ...notes, [r.id]: e.target.value })}
                        placeholder="Your thoughts… (a sentence is enough)" rows={3} />
              <button className="cta small" onClick={() => saveNote(r.id)}>{t("Guardar nota", "Save note")}</button>

              {r.transcript?.length > 0 && (
                <div className="translist">
                  <button className="tool" onClick={() => setShowTranscript(s => ({ ...s, [r.id]: !s[r.id] }))}>
                    {showTranscript[r.id] ? t("Ocultar conversación", "Hide conversation") : t("Ver conversación", "View conversation")}
                  </button>
                  {showTranscript[r.id] && (
                    <div className="transBody">
                      {r.transcript.map((m, i) => (
                        <div key={i} className={"tRow " + m.role}>
                          <b>{m.role === "me" ? t("Tú", "You") : t("Compañero", "Partner")}:</b> <TapText text={m.es} gloss={gloss} lookup={lookupWord} />
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
    </div>
  );
}

/* ==================== CSS ==================== */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,500&display=swap');
* { box-sizing: border-box; margin: 0; }
.app { min-height: 100vh; background: ${T.paper}; color: ${T.ink}; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; max-width: 560px; margin: 0 auto; }
.top { padding: 14px 20px 8px; display: flex; align-items: baseline; gap: 10px; }
.brand { font-family: 'Fraunces', Georgia, serif; font-size: 26px; font-weight: 600; letter-spacing: -0.5px; }
.dot { color: ${T.rosa}; }
.tag { font-size: 11px; color: ${T.dim}; letter-spacing: 0.04em; flex: 1; }
.enToggle { margin-left: auto; border: 1.5px solid ${T.line}; background: #fff; color: ${T.dim}; font-size: 11px; font-weight: 700; letter-spacing: .04em; border-radius: 99px; padding: 4px 10px; cursor: pointer; }
.enToggle.on { background: ${T.ink}; color: #fff; border-color: ${T.ink}; }
.profileChip { border: none; background: none; padding: 0; cursor: pointer; border-radius: 50%; }
.profileAvatar { width: 28px; height: 28px; border-radius: 50%; display: block; object-fit: cover; }
.profileAvatarFallback { background: ${T.ink}; color: #fff; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; }

.loginWrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
.loginCard { max-width: 360px; text-align: center; background: #fff; border: 1.5px solid ${T.line}; border-radius: 20px; padding: 32px 28px; box-shadow: 0 2px 0 ${T.line}; }
.loginCard .brand { font-size: 30px; margin-bottom: 10px; }
.loginCard .sub { margin-bottom: 20px; }
.googleBtn { display: flex; align-items: center; justify-content: center; gap: 10px; border: 1.5px solid ${T.line}; border-radius: 99px; padding: 12px 20px; font-size: 14.5px; font-weight: 600; color: ${T.ink}; text-decoration: none; background: #fff; }
.googleBtn:active { background: ${T.sand}; }
.privacyNote { display: flex; align-items: flex-start; gap: 10px; background: ${T.sand}; margin: 0 20px 10px; border-radius: 12px; padding: 9px 12px; font-size: 12px; line-height: 1.4; color: ${T.ink}; }
.privacyClose { background: none; border: none; color: ${T.dim}; font-size: 12px; cursor: pointer; padding: 0; flex-shrink: 0; }
.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.loading { padding: 40px; text-align: center; color: ${T.dim}; }
.pad { padding: 12px 20px 90px; overflow-y: auto; }
.center { text-align: center; }
.pad.center { padding-top: 60px; }
.display { font-family: 'Fraunces', Georgia, serif; font-weight: 600; font-size: 30px; line-height: 1.12; letter-spacing: -0.5px; margin-bottom: 10px; }
.display em { font-style: italic; color: ${T.rosa}; }
.sub { color: ${T.dim}; font-size: 14.5px; line-height: 1.5; margin-bottom: 18px; }
.warn { background: ${T.sand}; border-radius: 12px; padding: 10px 14px; font-size: 13px; margin-bottom: 14px; }

.scenes { display: flex; flex-direction: column; gap: 10px; }
.scene { display: flex; gap: 14px; align-items: center; text-align: left; background: #fff; border: 1.5px solid ${T.line}; border-radius: 16px; padding: 14px; cursor: pointer; transition: transform .12s, border-color .12s; position: relative; }
.sceneDel { position: absolute; top: 8px; right: 10px; color: ${T.dim}; font-size: 13px; padding: 4px; }

.contactList { display: flex; flex-direction: column; gap: 8px; }
.contactRow { display: flex; align-items: center; gap: 12px; text-align: left; background: #fff; border: 1.5px solid ${T.line}; border-radius: 16px; padding: 12px 14px; cursor: pointer; width: 100%; }
.contactEmoji { font-size: 26px; }
.contactBody { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.contactName { font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 6px; }
.contactPreview { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.contactTime { font-size: 11px; flex-shrink: 0; }
.unreadDot { width: 8px; height: 8px; border-radius: 50%; background: ${T.rosa}; display: inline-block; }
.creator { background: ${T.sand}; border: 1.5px dashed ${T.ink}33; border-radius: 16px; padding: 14px; }
.creatorTitle { font-family: 'Fraunces', Georgia, serif; font-size: 16px; font-weight: 600; }
.creatorSub { font-size: 12.5px; color: ${T.dim}; margin: 2px 0 10px; }
.creatorRow { display: flex; gap: 8px; }
.creatorRow input { flex: 1; border: 1.5px solid ${T.line}; border-radius: 99px; padding: 10px 14px; font-size: 14px; background: #fff; outline-color: ${T.rosa}; }
.creatorError { color: ${T.rosa}; font-size: 12.5px; margin-top: 8px; }
.helpCard { position: relative; background: ${T.leafSoft}; border-radius: 14px; padding: 12px 14px; margin-bottom: 10px; font-size: 14.5px; }
.helpClose { position: absolute; top: 8px; right: 10px; background: none; border: none; color: ${T.dim}; font-size: 14px; cursor: pointer; }
.starter { margin-bottom: 4px; }
.pistaBtn.wide { display: block; width: 100%; padding: 10px; margin-top: 8px; }
.helpFull { margin-top: 8px; }
.helpEn { font-size: 12.5px; color: ${T.dim}; font-style: italic; margin-top: 3px; }
.helpError { color: ${T.rosa}; font-size: 13px; }
.scene:active { transform: scale(.98); border-color: ${T.rosa}; }
.sceneEmoji { font-size: 28px; }
.sceneBody { display: flex; flex-direction: column; gap: 2px; }
.sceneTitle { font-family: 'Fraunces', Georgia, serif; font-size: 17px; font-weight: 600; }
.sceneGoal { font-size: 13px; }
.sceneWho { font-size: 12px; color: ${T.dim}; }

.chatWrap { display: flex; flex-direction: column; height: 100%; }
.chatHead { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid ${T.line}; }
.chatTitle { font-weight: 700; font-size: 15px; }
.chatGoal { font-size: 11.5px; color: ${T.dim}; }
.ghost { background: none; border: none; font-size: 20px; cursor: pointer; color: ${T.ink}; padding: 6px; }
.endBtn { margin-left: auto; background: ${T.leafSoft}; color: ${T.leaf}; border: none; border-radius: 99px; padding: 8px 12px; font-weight: 700; font-size: 12.5px; cursor: pointer; }
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
.pistaMask { text-align: center; font-family: 'Fraunces', Georgia, serif; font-size: 22px; letter-spacing: 1px; color: ${T.rosa}; background: ${T.rosaSoft}; border-radius: 12px; padding: 10px; margin-bottom: 10px; }
.revealRow { display: flex; gap: 10px; align-items: stretch; }
.pistaBtn { border: 1.5px solid ${T.line}; background: #fff; border-radius: 14px; padding: 0 16px; font-size: 14px; font-weight: 700; color: ${T.ink}; cursor: pointer; }
.cta.inRow { flex: 1; margin: 0; }
.spk { cursor: pointer; }
.bubble.me { background: ${T.ink}; color: #fff; border-bottom-right-radius: 6px; }
.bubble.err { color: ${T.rosa}; font-size: 13px; cursor: default; }
.typing { color: ${T.dim}; font-size: 10px; letter-spacing: 3px; }
.bubbleTools { display: flex; gap: 6px; margin-top: 7px; }
.tool { background: ${T.sand}; border: none; border-radius: 99px; padding: 4px 10px; font-size: 12px; cursor: pointer; color: ${T.ink}; }
.hintTool { font-weight: 700; letter-spacing: .03em; }
.hintText { margin-top: 6px; font-size: 12.5px; font-style: italic; color: ${T.dim}; }
.correction { margin-top: 6px; max-width: 82%; background: ${T.rosaSoft}; border-radius: 12px; padding: 8px 12px; font-size: 13px; }
.correction b { cursor: pointer; }
.corrLabel { color: ${T.rosa}; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
.corrWhy { color: ${T.dim}; font-size: 12px; margin-top: 2px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; max-width: 90%; }
.chip { background: ${T.sand}; border: 1.5px dashed ${T.ink}33; border-radius: 99px; padding: 6px 12px; font-size: 12.5px; cursor: pointer; color: ${T.ink}; }
.chip.saved { background: ${T.leafSoft}; border: 1.5px solid ${T.leaf}55; color: ${T.leaf}; }

.talkBar { border-top: 1px solid ${T.line}; padding: 8px 14px 12px; margin-bottom: 62px; }
.liveText { min-height: 20px; text-align: center; font-size: 13.5px; color: ${T.dim}; font-style: italic; margin-bottom: 6px; }
.liveText.tall { min-height: 24px; margin: 8px 0 4px; }
.liveText.err { color: ${T.rosa}; font-style: normal; font-weight: 600; }
.talkRow { display: flex; align-items: center; justify-content: center; gap: 22px; }
.talkRow.center { margin-top: 6px; }
.talkBtn { width: 76px; height: 76px; border-radius: 50%; border: none; background: ${T.rosa}; color: #fff; font-size: 28px; cursor: pointer; box-shadow: 0 4px 0 #A82554; transition: transform .1s; }
.talkBtn:active { transform: translateY(2px); box-shadow: 0 2px 0 #A82554; }
.talkBtn:disabled { opacity: .4; }
.talkBtn.small { width: 64px; height: 64px; font-size: 24px; }
.talkBtn.live { background: ${T.ink}; box-shadow: 0 4px 0 #0D1030; animation: pulse 1.2s infinite; }
@keyframes pulse { 0%,100% { outline: 6px solid ${T.rosa}33; } 50% { outline: 12px solid ${T.rosa}22; } }
@media (prefers-reduced-motion: reduce) { .talkBtn.live { animation: none; } .veilAnswer { animation: none; } }
.sideTool { width: 46px; height: 46px; border-radius: 50%; border: 1.5px solid ${T.line}; background: #fff; font-size: 18px; cursor: pointer; }
.typeRow { display: flex; gap: 8px; align-items: center; }
.typeRow input { flex: 1; border: 1.5px solid ${T.line}; border-radius: 99px; padding: 12px 16px; font-size: 15px; background: #fff; outline-color: ${T.rosa}; }
.sendBtn { width: 46px; height: 46px; border-radius: 50%; border: none; background: ${T.rosa}; color: #fff; font-size: 16px; cursor: pointer; }
.sendBtn:disabled { opacity: .35; }

.progress { font-size: 12px; color: ${T.dim}; margin-bottom: 8px; letter-spacing: .05em; }
.card { background: #fff; border: 1.5px solid ${T.line}; border-radius: 20px; padding: 22px 18px; box-shadow: 0 2px 0 ${T.line}; }
.cardLabel { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: ${T.dim}; margin-bottom: 6px; font-weight: 700; }
.cardEn { font-family: 'Fraunces', Georgia, serif; font-size: 26px; font-weight: 600; margin-bottom: 6px; }
.cardEx { color: ${T.dim}; font-style: italic; font-size: 14px; margin-bottom: 10px; }
.attempt { width: 100%; border: 1.5px solid ${T.line}; border-radius: 12px; padding: 12px 14px; font-size: 16px; margin-bottom: 4px; outline-color: ${T.rosa}; }
.veilAnswer { background: ${T.rosaSoft}; border-radius: 14px; padding: 14px; margin-bottom: 12px; animation: pop .18s ease-out; }
@keyframes pop { from { transform: scale(.96); opacity: 0; } }
.answerEs { font-family: 'Fraunces', Georgia, serif; font-size: 24px; font-weight: 600; color: ${T.rosa}; cursor: pointer; }
.answerEx { font-size: 14px; margin-top: 4px; font-style: italic; cursor: pointer; }
.attemptCheck { font-size: 12.5px; color: ${T.dim}; margin-top: 6px; }
.attemptCheck.yes { color: ${T.leaf}; font-weight: 700; }
.gradeRow { display: flex; gap: 10px; }
.gradeBtn { flex: 1; border: none; border-radius: 14px; padding: 12px; font-size: 15px; font-weight: 700; cursor: pointer; display: flex; flex-direction: column; gap: 2px; align-items: center; }
.gradeBtn span { font-size: 11px; font-weight: 400; opacity: .8; }
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
.toolCard { display: flex; gap: 12px; align-items: center; background: #fff; border: 1.5px solid ${T.line}; border-radius: 14px; padding: 12px 14px; cursor: pointer; font-size: 14px; }
.toolCard .dim { font-size: 12px; }
.toolEmoji { font-size: 22px; width: 30px; text-align: center; }
.addForm { display: flex; flex-direction: column; gap: 8px; background: ${T.sand}; border-radius: 14px; padding: 12px; margin-bottom: 12px; }
.addForm input { border: 1.5px solid ${T.line}; border-radius: 10px; padding: 10px 12px; font-size: 14px; background: #fff; outline-color: ${T.rosa}; }
.scanCard { position: relative; background: ${T.leafSoft}; border-radius: 14px; padding: 12px 14px; margin-bottom: 12px; font-size: 14px; }
.scanText { font-size: 15px; line-height: 1.5; margin-bottom: 10px; }
.scanTrans { color: ${T.dim}; font-style: italic; margin-bottom: 10px; }
.scanCard .deckRow { margin-bottom: 6px; }
.deckHead { margin-top: 6px; }
.deckRight { display: flex; align-items: center; gap: 6px; }
.miniBtn { background: none; border: 1px solid ${T.line}; border-radius: 99px; padding: 3px 9px; font-size: 11px; color: ${T.dim}; cursor: pointer; }
.miniBtn.add { background: ${T.leaf}; color: #fff; border-color: ${T.leaf}; font-weight: 700; }
.mnemo { margin-top: 10px; font-size: 13.5px; line-height: 1.45; background: #fff8; border-radius: 10px; padding: 8px 10px; }
.answerEn { font-size: 15px; color: ${T.ink}; margin-top: 2px; }
.bigSpk { display: block; margin: 8px auto 6px; width: 84px; height: 84px; border-radius: 50%; border: none; background: ${T.rosa}; color: #fff; font-size: 34px; cursor: pointer; box-shadow: 0 4px 0 #A82554; }
.howNote { margin-top: 16px; font-size: 12.5px; color: ${T.dim}; line-height: 1.5; }

.reflCard { background: #fff; border: 1.5px solid ${T.line}; border-radius: 16px; margin-bottom: 10px; overflow: hidden; }
.reflHead { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; cursor: pointer; font-size: 14.5px; }
.reflHeadRight { display: flex; align-items: center; gap: 12px; }
.reflDel { color: ${T.dim}; font-size: 13px; padding: 4px; }
.reflBody { padding: 0 16px 16px; font-size: 14px; line-height: 1.5; }
.reflBody p { margin-bottom: 12px; }
.canSay { background: ${T.leafSoft}; border-radius: 12px; padding: 10px 12px; margin-bottom: 12px; }
.canSayItem { font-family: 'Fraunces', Georgia, serif; font-size: 15px; color: ${T.leaf}; margin-top: 2px; cursor: pointer; }
.reflQ { background: ${T.sand}; border-radius: 10px; padding: 8px 12px; margin-bottom: 6px; font-size: 13.5px; }
.reflBody textarea { width: 100%; border: 1.5px solid ${T.line}; border-radius: 12px; padding: 10px 12px; font-size: 14px; font-family: inherit; margin-top: 8px; outline-color: ${T.rosa}; resize: vertical; }
.translist { margin-top: 10px; }
.transBody { margin-top: 8px; background: ${T.sand}; border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.tRow { font-size: 13.5px; }
.tRow b { color: ${T.dim}; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; margin-right: 4px; }

.nav { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 560px; display: flex; background: #fff; border-top: 1px solid ${T.line}; padding: 6px 0 10px; }
.navBtn { flex: 1; background: none; border: none; display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 11px; color: ${T.dim}; cursor: pointer; padding: 4px 0; }
.navBtn.on { color: ${T.rosa}; font-weight: 700; }
.navIcon { font-size: 20px; position: relative; }
.badge { position: absolute; top: -4px; right: -12px; background: ${T.rosa}; color: #fff; font-size: 10px; font-weight: 700; border-radius: 99px; min-width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; padding: 0 4px; }
`;
