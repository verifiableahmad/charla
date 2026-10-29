<p align="center">
  <img src="public/favicon.svg" alt="Charla logo" width="96" height="96" />
</p>

<h1 align="center">Charla</h1>

<p align="center"><b>Habla primero, teclea después.</b><br />Speak first, type later.</p>

Charla is a Spanish speaking-practice app. You talk through everyday scenes with AI characters, get texts from contacts who write to you first, review the words you saved with spaced repetition, and see what you can already do in Spanish.

## Stack

- React 18 + Vite client (`src/`)
- Express server (`server/`) with Postgres, Google sign-in and per-user storage
- Gemini by default (chat, text-to-speech, Live voice), or the learner's own OpenAI, Anthropic, OpenRouter or Gemini key

## Run it locally

```sh
cp .env.example .env   # fill in GEMINI_API_KEY, KEY_ENCRYPTION_SECRET, DATABASE_URL and the Google OAuth values
npm install
npm run dev            # server on :8787, client on :5173
```

The database schema is created and migrated on server start.

## Scripts

- `npm run dev`: server and client together
- `npm run build`: production build into `dist/`, served by the Express server
- `npm test`: unit tests for the sync layer and review scheduling

## Deploy

The `Dockerfile` builds the client and runs the server on port 8080. `fly.toml` is set up for Fly.io. Set the variables from `.env.example` as secrets. `TTS_CACHE_MB` (default 48) sizes the in-memory voice cache.

## License

MIT
