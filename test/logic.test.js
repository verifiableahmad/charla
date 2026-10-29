import { test } from "node:test";
import assert from "node:assert/strict";
import { schedule, nextInterval, dueWhen, maskHint, sanitizeScene, appendUser, removeChatFromProgress, DAY_MS } from "../src/logic.js";

const now = Date.UTC(2026, 9, 28, 12);

test("reviewing a card early doesn't grow its interval", () => {
  const card = { es: "hola", interval: 4, due: now + 3 * DAY_MS, reps: 2 };
  assert.equal(nextInterval(card, now), 4);
  const graded = schedule(card, true, now);
  assert.equal(graded.interval, 4);
  assert.equal(graded.due, now + 4 * DAY_MS);
});

test("a due card grows by 2.5x, a new one starts at a day, a miss comes back in 10 minutes", () => {
  assert.equal(nextInterval({ interval: 4, due: now - 1 }, now), 10);
  assert.equal(nextInterval({ interval: 0, due: now }, now), 1);
  const missed = schedule({ interval: 10, due: now, reps: 3 }, false, now);
  assert.equal(missed.interval, 0);
  assert.equal(missed.due, now + 10 * 60000);
});

test("a card due in 10 minutes isn't labelled tomorrow", () => {
  assert.deepEqual(dueWhen(now + 10 * 60000, now), { kind: "minutes", n: 10 });
  assert.deepEqual(dueWhen(now + 5 * 3600000, now), { kind: "hours", n: 5 });
  assert.deepEqual(dueWhen(now + DAY_MS, now), { kind: "tomorrow" });
  assert.deepEqual(dueWhen(now + 3 * DAY_MS, now), { kind: "days", n: 3 });
  assert.deepEqual(dueWhen(now - 1, now), { kind: "now" });
});

test("the hint shows the first letter, not the opening punctuation", () => {
  assert.equal(maskHint("¿Qué tal?"), "¿Q · ·   t · ·?");
  assert.equal(maskHint("hola"), "h · · ·");
});

test("a generated scene can't overwrite its id or custom flag, and needs the basics", () => {
  const scene = sanitizeScene({ title: "En la panadería", who: "Ana, a baker", opener: "¡Hola! ¿Qué quieres?", id: "mercado", custom: false, art: "nope", extra: 1 }, ["cafe"], "custom-1");
  assert.equal(scene.id, "custom-1");
  assert.equal(scene.custom, true);
  assert.equal(scene.art, undefined);
  assert.equal(scene.extra, undefined);
  assert.equal(sanitizeScene({ title: "x", opener: "y" }, [], "custom-2"), null);
  assert.equal(sanitizeScene(null, [], "custom-3"), null);
});

test("a learner line after a failed reply joins the previous one", () => {
  const h = [{ role: "assistant", content: "¿Qué tal?" }, { role: "user", content: "bien" }];
  assert.deepEqual(appendUser(h, "y tú"), [{ role: "assistant", content: "¿Qué tal?" }, { role: "user", content: "bien\ny tú" }]);
  assert.equal(appendUser([{ role: "assistant", content: "hola" }], "hola").length, 2);
});

test("deleting a chat takes its minutes and the can-do it completed back out", () => {
  const progress = {
    sessions: [{ ts: 1, minutes: 5, ref: 10 }, { ts: 2, minutes: 3, ref: 20 }],
    cando: {
      order: { status: "done", doneBy: 10, evidence: [{ ref: 10 }, { ref: 20 }] },
      price: { status: "partial", doneBy: null, evidence: [{ ref: 10 }] },
      day: { status: "done", doneBy: 20, evidence: [{ ref: 20 }] },
    },
    errors: { gender: 2 },
    days: {},
  };
  const next = removeChatFromProgress(progress, 10, [{ tag: "gender" }]);
  assert.deepEqual(next.sessions.map(s => s.ref), [20]);
  assert.equal(next.cando.order.status, "partial");
  assert.equal(next.cando.price, undefined);
  assert.equal(next.cando.day.status, "done");
  assert.equal(next.errors.gender, 1);
});
