# CLAUDE.md

Guidance for Claude Code when working in this repository.

> **Fork notice.** This is a fork of [`Tommi-K/pax-historia`](https://github.com/Tommi-K/pax-historia)
> (MIT, © 2026 Tommi-K). Upstream is `upstream`, this fork's remote is `origin`. **Both repos are
> public** — never commit secrets, API keys, or private data. Keep this file purely technical.
> Resync upstream with `git fetch upstream && git rebase upstream/main`.

An open-source, self-hostable alternative to Pax Historia: an AI-driven grand-strategy game on an
interactive world map. The browser is the brain — the server only stores JSON and streams map tiles.

## Run

```bash
git lfs install && git lfs pull   # map tiles are LFS (.pmtiles), required
npm install
npm run build                     # vite build -> dist/
node server/server.js             # serves dist/ + /api on :3000  (PORT env overrides)
```
Open http://localhost:3000.

- `npm run dev` (Vite, :5173) proxies `/api/*` → `:3000` (`vite.config.ts`); run the Express server
  alongside for data-driven work, or use the build+serve flow above.
- `npm run lint` — ESLint over `**/*.{ts,tsx}`.
- Server logging: `LOG_LEVEL` env (`debug`|`info`|`warn`|`error`, default `info`) controls verbosity
  via `server/log.js`; each `/api` request logs one line (method, path, status, ms).

## Stack & tooling

- **Frontend**: React 19, Vite 7. Files are `.jsx`/`.js` with a TypeScript overlay (strict tsconfig,
  lint-only — no emit). Map: `maplibre-gl` + `react-map-gl` + `pmtiles`. Charts: `chart.js`.
- **Backend**: Express 5, file-based persistence, no DB. Entry `server/server.js`.
- **React Compiler is enabled** (`babel-plugin-react-compiler`, `vite.config.ts`). Do **not** add
  manual `useMemo`/`useCallback` — write plain components and let the compiler memoize. Follow the
  rules of hooks (lint enforces `react-hooks` + `react-refresh`).
- Prod build splits vendor chunks: `react`, `maplibre`, `chart.js`.

## Architecture

```
Browser (React)  ──fetch /api──▶  Express (server.js)  ──▶  JSON files on disk
     │                                                       server/data/{scenarios,games}/
     └── calls the LLM directly (provider API) ── then PUTs resulting state back via /api
```

**By default AI runs client-side**: the browser interpolates the scenario's prompt templates, calls
the chosen provider's API directly (client-held key), parses the reply, and writes new state back
through `/api/runtime/json/*`. **Exception — the `server` provider**: the browser calls
`/api/llm/:modelId/chat/completions` and the server proxies to an OpenAI-compatible upstream,
injecting a server-held key from `.env` (keys never reach the client). See the AI layer below.

### Layout
- `src/main.jsx` → entry; registers the pmtiles maplibre protocol, mounts `App`.
- `src/App.jsx` → app shell: startup preload, map projection (globe/mercator), terrain toggle.
- `src/Game/Map/` → `World.jsx` (maplibre wrapper), `Nations.jsx` (country fill/outline/labels,
  polls world state every 5s), `Cities.jsx` (symbol layer from pmtiles).
- `src/Game/GameUI/` → `main.jsx` orchestrates the UI; `settings.jsx` (provider/model/key picker),
  `chat.jsx` (diplomacy), `advisor.jsx` (chart.js advisor), `time.jsx`, `search.jsx`, `actions.jsx`.
- `src/Game/AI/` → the LLM layer (see below).
- `src/runtime/` → `assets.js` (multi-layer fetch+cache, Cache API persistence, pmtiles decode),
  `library.js` / `scenarios.js` (external stores via `useSyncExternalStore`, talk to `/api`),
  `preload.js` (30s weighted startup pipeline), `gameState.js` (normalizers), `countryLabels.js`.
- `server/` → `server.js` (Express + routes), `libraryStore.js` (scenarios **and** games),
  `scenarioStore.js` (scenarios only), `env.js` (zero-dep `.env` loader), `log.js` (zero-dep
  leveled logger + `requestLogger` middleware), `aiProxy.js` (managed-model catalog +
  key-injecting LLM proxy), `config/serverModels.json` (model catalog).
  `server/data/` is the on-disk store (gitignored except `scenarios/`).

### State management
No Redux/Zustand. Two patterns: external stores in `src/runtime/library.js`/`scenarios.js`
(observer + `useSyncExternalStore`) for game/scenario catalog; in-memory `Map` caches in
`assets.js` for JSON/binary assets; local `useState`/`useRef` inside components.

## Data model: scenario vs game

- **Scenario** = editable template: metadata + seed data (`game.json`, `world.json`,
  `prompts.json`) + optional `colors.json` and `.pmtiles`. Clean, no runtime state.
- **Game** = a playable instance seeded from a scenario (carries `scenarioId`); holds live runtime
  state under `storage/` (`actions`, `chat`, `events`, `advisor`). Edits to a game never touch its
  scenario. A scenario can't be deleted while a game references it.
- Manifests track order + active selection: `scenario-manifest.json`, `game-manifest.json`.
- `prompts.json` holds the system prompts (`advisor`, `leader`) with `${country}`, `${date}`,
  `${actions}`, `${chat}` … template vars interpolated **client-side**.

## API (all under `/api`, see `server/server.js`)

- `/api/library` — unified catalog (scenarios + games + active state).
- `/api/scenarios[/:id]` — CRUD; `/:id/export?mode=light|full`, `/import`, `/:id/assets/:key`.
- `/api/games[/:id]` — CRUD; `/active`, `/:id/assets/:key`.
- `/api/runtime/json/:key` — GET/PUT live game state (actions/chat/events/advisor). **This is where
  the client persists LLM output.**
- `/api/runtime/pmtiles/:key` — streams map tiles with HTTP range (206) support.
- `/api/config` — public list of server-managed models (`{id,label}` only, no keys).
- `POST /api/llm/:modelId/chat/completions` — proxies to the model's upstream with a server-held key.

Body limits are large (≈2GB) to allow scenario bundle import/export and tile uploads.

## AI / LLM layer (`src/Game/AI/`)

- `providerConfig.js` — 5 providers. The first four store settings in `localStorage` (per-provider
  `apiKey`, `model`, and `endpoint` for the compatible one); `server` stores only a model `id`:
  - `gemini` → `https://generativelanguage.googleapis.com/...:generateContent` (default
    `gemini-3.1-flash-lite-preview`)
  - `openai` → `https://api.openai.com/v1/chat/completions` (model auto-discovered if blank)
  - `anthropic` → `https://api.anthropic.com/v1/messages`, header
    `anthropic-dangerous-direct-browser-access: true` (default `claude-haiku-4-5`)
  - `openai-compatible` → user `endpoint` + `/chat/completions` (**OpenRouter**, Ollama, LM Studio,
    vLLM). Default endpoint `http://localhost:11434/v1` (Ollama). For OpenRouter set endpoint
    `https://openrouter.ai/api/v1`.
  - `server` → server-managed: stores only a chosen model `id`, calls `/api/llm/:id/chat/completions`.
    No key in the browser — keys/models are configured in `server/config/serverModels.json` + `.env`.
- `main.jsx` — `callAI(systemPrompt, history, opts)` dispatches by stored provider;
  `callGemini`/`callOpenAI`/`callAnthropic`/`callOpenAICompatible`/`callServerModel` each retry 3× on
  429/503 (the last two share the OpenAI-style chat-completions path). Gemini history format is
  canonical; `toOpenAIMessages`/`toAnthropicMessages` convert it. Builds advisor and diplomatic
  system prompts from scenario prompts + current game data.
- `gameplay.js` — `runJsonTask(key, {...})` for structured tasks (timeline jump, action
  suggestions, catalyst). No streaming, no enforced JSON schema: prompts ask for JSON, then
  `extractJsonPayload()` parses (direct → markdown fence → regex) with deterministic fallbacks.
- `gameplayPrompts.js` — default system-prompt scaffolding.

Client-provider keys live in `localStorage`, never in repo files. The `server` provider's keys live
in `.env` (gitignored, server-side only) — neither is at risk of being committed.

## Conventions

- Hooks `use*`, handlers `handle*`, callbacks `on*`, caches `*Cache` (Map/Set), URLs `*Url`.
- Lazy-load heavy panels via dynamic `import()` + `Suspense`.
- Plain CSS in `src/styles.css` (dark theme, no Tailwind); layout often via inline styles.
- pmtiles URL scheme is `pmtiles://<full-url>`; protocol registered once at startup.

## Working on this fork (git workflow)

This is a **public** fork; commits are a public business card — keep them clean, atomic, and
respectful of upstream. Adopted model (KISS / YAGNI):

- **`main` is the fork's trunk.** Day-to-day fork work is committed **directly to `main`** with clean
  conventional commits. Fork-only artifacts (`CLAUDE.md`, `CHANGELOG.md`, server tooling, personal
  features) live here. Resync upstream with `git fetch upstream && git rebase upstream/main`.
- **Branch only for a real upstream PR**, cut from `upstream/main`, holding *only* that change —
  short-lived, deleted after merge. Don't pre-create branches.
- **Ours vs upstream**: genuine fixes/improvements to the original → upstream PR branch. Personal
  tooling (this `CLAUDE.md`, local experiments) stays on the fork.
- **Commit messages**: English, conventional prefixes (`feat:`, `fix:`, `chore:`, `docs:`).
- **Changelog**: update `CHANGELOG.md` (Keep a Changelog) in the same commit as the change.
- **Secrets**: never commit `.env`/keys; stage explicit files, never `git add .` blindly. If a
  secret is about to be staged, stop.
- **License**: MIT — keep `LICENSE` and Tommi-K's copyright intact; don't rewrite the README under
  our name or drop credits.
- **No noisy diffs**: don't reformat/restyle existing files without a functional reason.
