# Changelog

All notable changes to this fork are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Admin map editor.** A new bottom-left 🛠️ button opens an "Admin mode" panel to
  edit the active game's map: rename + recolor states, create new states, annex a
  whole state into another (all its regions transfer at once), and reassign single
  regions by clicking them on the map. Edits are staged as a draft and persisted to
  the active game's `world.json` (`polityOverrides`/`regionOwnershipOverrides`) and
  `colors.json` on save; the map reflects them within ~5s. New files
  `src/Game/Admin/adminBus.js` (map↔panel bus) and `src/Game/GameUI/admin.jsx`
  (lazy panel); `Nations.jsx` now routes region clicks to the panel while admin
  mode is active and polls `colors.json` so recolors show up live.

### Fixed
- Region ownership overrides (`regionOwnershipOverrides`, keyed by `GID_1`) now
  actually repaint the map. They were matched against the `countries` fill layer,
  whose features only carry `GID_0` — so per-region transfers never showed. The
  override tint is now painted on the region-granular `regions` layer (previously
  an invisible click-only layer).
- Reassigned regions now show the *pure* new-owner color, and a country that loses
  all its regions disappears from the map. Previously the `regions` override tint
  (`0.66` opacity) was layered over the original owner's base `countries` fill
  (also `0.66`), so an annexed region rendered as a muddy blend of both colors —
  and the emptied country kept its label and base tint (a "ghost state"). The
  `regions` layer is now the authoritative fill for every region, colored by its
  *effective* owner (`override ?? GID_0`); the base `countries` fill is forced
  transparent under any country that has region geometry (it still paints
  countries with no regions, so no holes appear). Country labels
  (`runtime/countryLabels.js`) now carry their `GID_0` code and are hidden when a
  region-subdivided country owns zero remaining regions.
- The region info popup (`Selection/Regions.jsx`) now reports a region's *effective*
  owner — name and flag — by honoring `regionOwnershipOverrides`/`polityOverrides`
  instead of the static `GID_0` baked into the tile. An annexed region used to keep
  showing its original country (e.g. Istria still read "Croatia" after annexation).
- `docs/ai-business-logic.md`: authoritative map of the AI layer — prompt
  templates and the full `${...}` variable reference, LLM dispatch, structured
  tasks, world initialization, and where game state lives and persists.
  `CLAUDE.md` now points to it as required reading for AI/prompt/state work.
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
