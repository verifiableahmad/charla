import { test } from "node:test";
import assert from "node:assert/strict";
import { SyncedKey } from "../src/sync.js";

// A stand-in for /api/data with the same version rules as server/data.js.
function fakeServer() {
  const rows = new Map(); // key → { value, version }
  const state = { down: false, signedOut: false, puts: 0 };
  const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
  const fetchImpl = async (url, opts = {}) => {
    if (state.down) throw new Error("offline");
    if (state.signedOut) return reply(401, { error: "Not signed in" });
    const key = url.split("/").pop();
    const row = rows.get(key);
    if (!opts.method) return row ? reply(200, row) : reply(404, { version: 0 });
    state.puts++;
    const { value, baseVersion } = JSON.parse(opts.body);
    const current = row?.version ?? 0;
    if (current !== baseVersion) return reply(409, { value: row?.value ?? null, version: current });
    rows.set(key, { value, version: current + 1 });
    return reply(200, { ok: true, version: current + 1 });
  };
  return { rows, state, fetchImpl };
}

function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m };
}

const client = (server, storage = memoryStorage(), onStatus) =>
  new SyncedKey("palabras", [], { scope: "u1", fetchImpl: server.fetchImpl, storage, debounceMs: 0, onStatus });

test("a failed load throws instead of pretending the account is empty", async () => {
  const server = fakeServer();
  server.rows.set("palabras", { value: [{ es: "hola" }], version: 3 });
  server.state.down = true;
  const a = client(server);
  await assert.rejects(a.load());
  assert.throws(() => a.update(ws => [...ws, { es: "adiós" }]));
  assert.deepEqual(server.rows.get("palabras").value, [{ es: "hola" }]);
});

test("two tabs saving from the same version both keep their changes", async () => {
  const server = fakeServer();
  const a = client(server), b = client(server);
  await a.load(); await b.load();
  a.update(ws => [...ws, { es: "hola" }]);
  b.update(ws => [...ws, { es: "adiós" }]);
  await a.flush(); await b.flush(); // b gets a 409 and replays its change on a's copy
  assert.deepEqual(server.rows.get("palabras").value.map(w => w.es), ["hola", "adiós"]);
  assert.deepEqual(b.value.map(w => w.es), ["hola", "adiós"]);
});

test("changes made while a save is in flight are not lost", async () => {
  const server = fakeServer();
  const a = client(server);
  await a.load();
  a.update(ws => [...ws, { es: "uno" }]);
  const first = a.flush();
  a.update(ws => [...ws, { es: "dos" }]);
  await first;
  await a.flush();
  assert.deepEqual(server.rows.get("palabras").value.map(w => w.es), ["uno", "dos"]);
  assert.equal(a.pending.length, 0);
});

test("an expired session reports auth and the change survives a reload", async () => {
  const server = fakeServer();
  const storage = memoryStorage();
  const statuses = [];
  const a = client(server, storage, (k, s) => statuses.push(s));
  await a.load();
  server.state.signedOut = true;
  a.update(ws => [...ws, { es: "hola" }]);
  await a.flush();
  assert.deepEqual(statuses, ["auth"]);
  assert.equal(server.rows.get("palabras"), undefined);

  server.state.signedOut = false; // signed in again, new page load
  const b = client(server, storage);
  await b.load();
  await b.flush();
  assert.deepEqual(server.rows.get("palabras").value, [{ es: "hola" }]);
  assert.equal(storage.m.size, 0);
});

test("a rescue copy is dropped if the server moved on since it was made", async () => {
  const server = fakeServer();
  const storage = memoryStorage();
  storage.setItem("charla:unsaved:u1:palabras", JSON.stringify({ value: [{ es: "viejo" }], baseVersion: 0 }));
  server.rows.set("palabras", { value: [{ es: "nuevo" }], version: 2 });
  const a = client(server, storage);
  await a.load();
  assert.deepEqual(a.value, [{ es: "nuevo" }]);
  assert.equal(storage.m.size, 0);
});

test("updates that change nothing don't save", async () => {
  const server = fakeServer();
  const a = client(server);
  await a.load();
  a.update(ws => ws);
  await a.flush();
  assert.equal(server.state.puts, 0);
});

test("refresh picks up another device's save when nothing is pending", async () => {
  const server = fakeServer();
  const a = client(server);
  await a.load();
  server.rows.set("palabras", { value: [{ es: "remoto" }], version: 1 });
  await a.refresh();
  assert.deepEqual(a.value, [{ es: "remoto" }]);
});
