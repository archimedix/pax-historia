# Changelog

All notable changes to this fork are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Starting world briefing for the `default` scenario: `world.json` now seeds
  `startingTimelineText` (major powers at 1 Jan 2016, with historical allies and
  rivals) and `simulationRules`. This lore reaches the advisor, diplomacy, and the
  structured tasks via the `WORLD_BEFORE_ROUND_ONE_TEXT` /
  `HISTORICAL_PRESET_SIMULATION_RULES` helpers.
- Minimal zero-dependency leveled logger (`server/log.js`): `debug`/`info`/`warn`/
  `error` gated by `LOG_LEVEL` (default `info`), plus a `requestLogger` Express
  middleware that logs one line per `/api` request (method, path, status, ms).
  A single console call site keeps it drop-in replaceable by `pino` later.
- Catalog entries for Qwen3.6 Plus and DeepSeek V4 (Pro + Flash) via OpenRouter.
- **Server-managed AI models.** The server can now expose a catalog of
  pre-configured models (`server/config/serverModels.json`) and proxy chat
  completions to OpenAI-compatible upstreams (OpenRouter, OpenAI, …). API keys
  live in `.env` and stay server-side — they are never sent to the browser.
  A new "Server" provider in the settings panel lets you pick one of the
  configured models from a dropdown (no key field). When no key is configured
  the catalog is empty and every existing provider keeps working as before.
- Minimal zero-dependency `.env` loader (`server/env.js`) and `.env.example`.
- Dev proxy in `vite.config.ts` so `npm run dev` reaches the backend on `:3000`.

### Changed
- Consolidated fork-hygiene work onto `main`: ignore `.env`, remove stray empty
  files, add `CLAUDE.md`.
- Updated `CLAUDE.md` for the server-managed-models architecture and the
  trunk-based git workflow.

### Fixed
- Broken template variables in the `default` scenario's `advisor`/`leader` prompts:
  `${country}` (and the case-typo `${startdate}` in `leader`) were undefined and
  rendered as empty strings. Replaced with the UPPERCASE helper aliases
  (`${PLAYER_POLITY}`, `${STARTING_ROUND_DATE}`, `${ORIGIN_ROUND_DATE}`), and added a
  world-context block so both prompts receive the world briefing and current summary.

### Removed
- Dead legacy `server/scenarioStore.js`. It was a scenarios-only predecessor of
  `server/libraryStore.js`, no longer imported anywhere; all of its exports have
  live equivalents in `libraryStore.js`.
