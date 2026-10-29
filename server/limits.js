// Per-user token buckets. Every signed-in Google account can reach the shared Gemini key, so
// without these one script could spend the whole free tier (or a lot of money) in minutes.
// In-memory, so each server instance counts on its own — fine for keeping abuse bounded.
const buckets = new Map(); // `${name}:${userId}` → { tokens, at }

export function rateLimit(name, { burst, perMinute }) {
  return (req, res, next) => {
    const key = `${name}:${req.user.id}`;
    const now = Date.now();
    const b = buckets.get(key) || { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 60000) * perMinute);
    b.at = now;
    buckets.set(key, b);
    if (b.tokens < 1) {
      res.set("Retry-After", String(Math.ceil(((1 - b.tokens) / perMinute) * 60)));
      return res.status(429).json({ error: "Too many requests — slow down a little.", kind: "rate" });
    }
    b.tokens -= 1;
    next();
  };
}

// Full buckets carry no information, so drop them rather than keep every user forever.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60000;
  for (const [key, b] of buckets) if (b.at < cutoff) buckets.delete(key);
}, 10 * 60000).unref();
