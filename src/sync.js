/* ---------- Account data sync ----------
   Each key (the deck, reflections, threads…) is one versioned JSON blob on the server. Every
   change is a function of the previous value, so when another tab or device saved first (409),
   the unsaved changes are replayed on top of the server's copy instead of overwriting it.
   Unsaved changes are also mirrored to localStorage, so a closed tab or an expired session
   doesn't lose them: they're re-applied on the next load if the server hasn't moved on.
------------------------------------------- */

const RETRY_MS = [2000, 5000, 15000, 30000];

export class SyncedKey {
  constructor(key, fallback, { scope = "", fetchImpl, storage, debounceMs = 600, onStatus } = {}) {
    this.key = key;
    this.fallback = fallback;
    this.fetch = fetchImpl || ((...args) => fetch(...args));
    this.storage = storage === undefined ? (typeof localStorage !== "undefined" ? localStorage : null) : storage;
    this.rescueKey = `charla:unsaved:${scope}:${key}`;
    this.debounceMs = debounceMs;
    this.onStatus = onStatus || (() => {});
    this.base = fallback;   // last value the server confirmed
    this.version = 0;
    this.pending = [];      // changes not yet confirmed, in order
    this.value = fallback;  // base with pending applied: what the app shows
    this.loaded = false;
    this.inflight = null;
    this.timer = null;
    this.failures = 0;
    this.status = "ok";     // "ok" | "error" | "auth"
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setStatus(status) {
    if (status === this.status) return;
    this.status = status;
    this.onStatus(this.key, status);
  }

  recompute() {
    const next = this.pending.reduce((v, fn) => fn(v), this.base);
    if (next === this.value) return;
    this.value = next;
    this.listeners.forEach((fn) => fn(next));
  }

  async get() {
    const res = await this.fetch(`/api/data/${this.key}`);
    if (res.status === 404) return { value: this.fallback, version: 0 };
    if (!res.ok) throw Object.assign(new Error(`Couldn't load ${this.key} (${res.status})`), { status: res.status });
    const data = await res.json();
    return { value: data.value ?? this.fallback, version: data.version ?? 0 };
  }

  // Throws if the server can't be read. Callers must not let the app save over data it never saw.
  async load() {
    const { value, version } = await this.get();
    this.base = value;
    this.version = version;
    this.loaded = true;
    const rescue = this.readRescue();
    if (rescue && rescue.baseVersion === version) this.pending = [() => rescue.value];
    else this.clearRescue();
    this.recompute();
    if (this.pending.length) this.flush();
  }

  // Picks up what another tab or device saved, when nothing here is waiting to be saved.
  async refresh() {
    if (!this.loaded || this.pending.length || this.inflight) return;
    try {
      const { value, version } = await this.get();
      if (version === this.version || this.pending.length || this.inflight) return;
      this.base = value;
      this.version = version;
      this.recompute();
    } catch {}
  }

  update(fn) {
    if (!this.loaded) throw new Error(`${this.key} changed before it loaded`);
    if (fn(this.value) === this.value) return; // nothing changed, nothing to save
    this.pending.push(fn);
    this.recompute();
    this.writeRescue();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  async flush() {
    clearTimeout(this.timer);
    if (this.inflight || !this.pending.length || !this.loaded) return this.inflight;
    const batch = this.pending.length;
    const next = this.pending.reduce((v, fn) => fn(v), this.base);
    this.inflight = (async () => {
      let res, data;
      try {
        res = await this.fetch(`/api/data/${this.key}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: next, baseVersion: this.version }),
        });
        data = await res.json().catch(() => ({}));
      } catch {
        res = null;
      }
      this.inflight = null;
      if (res?.ok) {
        this.base = next;
        this.version = data.version;
        this.pending.splice(0, batch);
        this.failures = 0;
        this.setStatus("ok");
        this.recompute();
        if (this.pending.length) this.writeRescue();
        else this.clearRescue();
        if (this.pending.length) return this.flush();
        return;
      }
      if (res?.status === 409) {
        // Someone else saved first: take their copy and replay our changes on top of it.
        this.base = data.value ?? this.fallback;
        this.version = data.version ?? 0;
        this.recompute();
        this.writeRescue();
        return this.flush();
      }
      if (res?.status === 401) {
        this.setStatus("auth"); // kept in pending + localStorage until the learner signs in again
        return;
      }
      this.setStatus("error");
      const wait = RETRY_MS[Math.min(this.failures++, RETRY_MS.length - 1)];
      this.timer = setTimeout(() => this.flush(), wait);
    })();
    return this.inflight;
  }

  readRescue() {
    try { return JSON.parse(this.storage?.getItem(this.rescueKey) || "null"); } catch { return null; }
  }
  writeRescue() {
    try { this.storage?.setItem(this.rescueKey, JSON.stringify({ value: this.value, baseVersion: this.version })); } catch {}
  }
  clearRescue() {
    try { this.storage?.removeItem(this.rescueKey); } catch {}
  }
}
