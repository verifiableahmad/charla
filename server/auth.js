import express from "express";
import crypto from "crypto";
import pool from "./db.js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

const SESSION_COOKIE = "charla_session";
const STATE_COOKIE = "charla_oauth_state";
const SESSION_DAYS = 30;

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function setCookie(res, name, value, { maxAge, expirePast } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  if (expirePast) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  else if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  res.setHeader("Set-Cookie", parts.join("; "));
}

export async function getSessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, u.picture FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > now()`,
      [token]
    );
    return rows[0] || null;
  } catch {
    return null; // DB unreachable — degrade to "not signed in" rather than 500ing every request
  }
}

const router = express.Router();

router.get("/google", (req, res) => {
  if (!CLIENT_ID) return res.status(500).send("Server is missing GOOGLE_CLIENT_ID");
  const state = crypto.randomBytes(16).toString("hex");
  setCookie(res, STATE_COOKIE, state, { maxAge: 600 });
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get("/google/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    const cookies = parseCookies(req);
    if (!code || !state || state !== cookies[STATE_COOKIE]) {
      return res.status(400).send("Invalid sign-in attempt — please try again.");
    }
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.id_token) {
      throw new Error(tokenData.error_description || "Google token exchange failed");
    }
    // The id_token came straight from Google over a server-to-server HTTPS call,
    // so we trust it without re-verifying the signature — just decode the payload.
    const payload = JSON.parse(Buffer.from(tokenData.id_token.split(".")[1], "base64url").toString("utf8"));
    const { sub: googleId, email, name, picture } = payload;

    const { rows } = await pool.query(
      `INSERT INTO users (google_id, email, name, picture)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_id) DO UPDATE SET email = $2, name = $3, picture = $4
       RETURNING id`,
      [googleId, email, name, picture]
    );
    const userId = rows[0].id;

    const sessionToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
    await pool.query(`INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)`, [sessionToken, userId, expiresAt]);

    setCookie(res, SESSION_COOKIE, sessionToken, { maxAge: SESSION_DAYS * 86400 });
    setCookie(res, STATE_COOKIE, "", { expirePast: true });
    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(500).send("Sign-in failed — please try again.");
  }
});

router.get("/me", async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });
  res.json({ user });
});

router.post("/logout", async (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);
  setCookie(res, SESSION_COOKIE, "", { expirePast: true });
  res.json({ ok: true });
});

export default router;
