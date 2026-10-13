import express from "express";
import pool from "./db.js";
import { getSessionUser } from "./auth.js";

// Mirrors the client's old localStorage keys — a generic per-user JSONB blob store is
// enough here; none of this data needs real relational structure or querying.
const ALLOWED_KEYS = new Set(["palabras", "reflexiones", "escenas", "glosario", "hilos"]);

const router = express.Router();

router.use(async (req, res, next) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });
  req.user = user;
  next();
});

router.get("/:key", async (req, res) => {
  const { key } = req.params;
  if (!ALLOWED_KEYS.has(key)) return res.status(400).json({ error: "Unknown key" });
  try {
    const { rows } = await pool.query(`SELECT value FROM user_data WHERE user_id = $1 AND key = $2`, [req.user.id, key]);
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    res.json({ value: rows[0].value });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

router.put("/:key", async (req, res) => {
  const { key } = req.params;
  if (!ALLOWED_KEYS.has(key)) return res.status(400).json({ error: "Unknown key" });
  if (req.body.value === undefined) return res.status(400).json({ error: "Missing value" });
  try {
    await pool.query(
      `INSERT INTO user_data (user_id, key, value, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id, key) DO UPDATE SET value = $3, updated_at = now()`,
      [req.user.id, key, JSON.stringify(req.body.value)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
