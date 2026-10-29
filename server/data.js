import express from "express";
import pool from "./db.js";
import { getSessionUser } from "./auth.js";

// Mirrors the client's old localStorage keys — a generic per-user JSONB blob store is
// enough here; none of this data needs real relational structure or querying.
const ALLOWED_KEYS = new Set(["palabras", "reflexiones", "escenas", "glosario", "hilos", "progreso"]);

const router = express.Router();

router.use(async (req, res, next) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });
  req.user = user;
  next();
});

// A key that was never saved is version 0, the same as a row written before versions existed.
router.get("/:key", async (req, res) => {
  const { key } = req.params;
  if (!ALLOWED_KEYS.has(key)) return res.status(400).json({ error: "Unknown key" });
  try {
    const { rows } = await pool.query(`SELECT value, version FROM user_data WHERE user_id = $1 AND key = $2`, [req.user.id, key]);
    if (!rows[0]) return res.status(404).json({ error: "Not found", version: 0 });
    res.json({ value: rows[0].value, version: rows[0].version });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Body: { value, baseVersion } — only written if the stored version still equals baseVersion.
// Otherwise 409 with the current value, so the client can replay its changes on top of it.
router.put("/:key", async (req, res) => {
  const { key } = req.params;
  if (!ALLOWED_KEYS.has(key)) return res.status(400).json({ error: "Unknown key" });
  const { value, baseVersion } = req.body;
  if (value === undefined) return res.status(400).json({ error: "Missing value" });
  if (!Number.isInteger(baseVersion) || baseVersion < 0) return res.status(400).json({ error: "Missing baseVersion" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO user_data (user_id, key, value, version, updated_at) VALUES ($1, $2, $3, 1, now())
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, version = user_data.version + 1, updated_at = now()
       WHERE user_data.version = $4
       RETURNING version`,
      [req.user.id, key, JSON.stringify(value), baseVersion]
    );
    if (rows[0]) return res.json({ ok: true, version: rows[0].version });
    const current = await pool.query(`SELECT value, version FROM user_data WHERE user_id = $1 AND key = $2`, [req.user.id, key]);
    res.status(409).json({ error: "Version conflict", value: current.rows[0]?.value ?? null, version: current.rows[0]?.version ?? 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
