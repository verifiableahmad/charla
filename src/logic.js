/* ---------- Pure helpers: review scheduling, hints, model-output cleanup ----------
   Kept out of App.jsx so they can be tested without a browser (npm test).
------------------------------------------- */

export const DAY_MS = 86400000;
const AGAIN_MS = 10 * 60000;

export const strip = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¿?¡!.,"“”]/g, "").trim();

// Days until a card comes back if it's graded "I knew it" now. Reviewing early (from "Review them
// all") keeps the interval as it is: knowing it before it was due proves nothing about a longer gap.
export function nextInterval(card, now = Date.now()) {
  if (!card.interval) return 1;
  if (card.due > now) return card.interval;
  return Math.round(card.interval * 2.5);
}

export function schedule(card, good, now = Date.now()) {
  if (!good) return { ...card, interval: 0, due: now + AGAIN_MS, reps: card.reps + 1, last: now };
  const interval = nextInterval(card, now);
  return { ...card, interval, due: now + interval * DAY_MS, reps: card.reps + 1, last: now };
}

// When a card is next due, in a shape the UI turns into words.
export function dueWhen(due, now = Date.now()) {
  const ms = due - now;
  if (ms <= 0) return { kind: "now" };
  if (ms < 60 * 60000) return { kind: "minutes", n: Math.max(1, Math.round(ms / 60000)) };
  if (ms < 20 * 3600000) return { kind: "hours", n: Math.round(ms / 3600000) };
  const days = Math.max(1, Math.round(ms / DAY_MS));
  return days === 1 ? { kind: "tomorrow" } : { kind: "days", n: days };
}

// "¿Qué tal?" → "¿Q · ·   t · ·?": the first letter of each word, punctuation left where it is.
export function maskHint(text) {
  return text.split(/\s+/).filter(Boolean).map(word => {
    let shown = false, out = "";
    for (const ch of word) {
      if (!/\p{L}/u.test(ch)) out += ch;
      else if (!shown) { out += ch; shown = true; }
      else out += " ·";
    }
    return out;
  }).join("   ");
}

// Only the fields a scene uses, each a bounded string, with our own id last so nothing in the
// model's JSON can overwrite it. Null when the scene can't be used.
const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : "");
export function sanitizeScene(p, artKeys, id) {
  const title = str(p?.title, 60), who = str(p?.who, 160), opener = str(p?.opener, 300);
  if (!title || !who || !opener) return null;
  const goal = str(p.goal, 200) || "Have a real conversation";
  return {
    title, title_en: str(p.title_en, 60) || title,
    goal, goal_es: str(p.goal_es, 200) || goal,
    who, who_es: str(p.who_es, 160) || who,
    voice: p.voice === "male" ? "male" : "female",
    ...(artKeys.includes(p.art) && { art: p.art }),
    opener, hint: str(p.hint, 300),
    id, custom: true,
  };
}

// A model's per-reply glossary, keyed the way TapText looks words up.
export function normGloss(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = strip(k);
    if (key && typeof v === "string" && v.trim()) out[key] = v.trim().toLowerCase().slice(0, 60);
  }
  return out;
}

// Adds a learner line to a conversation history. If the last turn is also the learner's (the
// reply to it failed), the two are joined, so the model sees both and roles keep alternating.
export function appendUser(history, content) {
  const last = history[history.length - 1];
  if (last?.role === "user" && typeof last.content === "string") {
    return [...history.slice(0, -1), { role: "user", content: `${last.content}\n${content}` }];
  }
  return [...history, { role: "user", content }];
}

export const dropTrailingError = msgs => (msgs.length && msgs[msgs.length - 1].error ? msgs.slice(0, -1) : msgs);

// Takes one chat's minutes, evidence and error counts back out of the progress record, for
// when the learner deletes that chat. A can-do it completed goes back to "in progress".
export function removeChatFromProgress(progress, ref, fixes = []) {
  const cando = {};
  for (const [id, entry] of Object.entries(progress.cando || {})) {
    const evidence = (entry.evidence || []).filter(e => e.ref !== ref);
    const undone = entry.doneBy === ref;
    if (undone && !evidence.length) continue;
    if (!undone && !evidence.length && entry.status !== "done") continue;
    cando[id] = { ...entry, evidence, ...(undone && { status: "partial", doneBy: null }) };
  }
  const errors = { ...(progress.errors || {}) };
  fixes.forEach(f => { if (errors[f.tag] > 0) errors[f.tag] -= 1; });
  return { ...progress, sessions: (progress.sessions || []).filter(s => s.ref !== ref), cando, errors };
}
