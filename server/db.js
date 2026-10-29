import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      picture TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- google_id is the identity; an email can move between Google accounts, and a unique email
    -- made the second account's sign-in fail.
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS user_data (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, key)
    );
    -- Bumped on every write, so a client saving from a stale copy gets a 409 instead of
    -- silently overwriting what another tab or device saved.
    ALTER TABLE user_data ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS ai_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      models JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS ai_keys (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      key_enc TEXT NOT NULL,
      key_hint TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, provider)
    );
  `);
}

export async function pruneSessions() {
  await pool.query(`DELETE FROM sessions WHERE expires_at < now()`);
}

export default pool;
