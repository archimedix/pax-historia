# AI business logic — system map

> Map of the AI layer: what it does, where data lives, which component edits it.
> Code under `src/Game/AI/`, `src/runtime/`, `server/`. Paths are `file:line` (clickable).

## 1. Architecture principle

**Browser is the brain, server is just storage.** The React client:
1. loads the scenario/game prompt templates,
2. interpolates them with current game state,
3. calls the chosen provider's LLM directly,
4. parses the reply,
5. writes the new state to disk via `/api/runtime/json/*`.

```
Browser (React)
  │ 1. read prompts.json + state (game/world/actions/chat/events/advisor)
  │ 2. interpolate templates → systemPrompt
  │ 3. callAI(systemPrompt, history) ──► LLM provider
  │ 4. parse reply
  │ 5. PUT updated state
  ▼
Express (server/server.js) ──► JSON files on disk (server/data/games/<id>/)
```

**Exception**: the `server` provider — browser calls `/api/llm/:modelId/chat/completions`
and the server proxies to an OpenAI-compatible upstream, injecting a server-side key from
`.env` (key never reaches the client).

---

## 2. Where prompts live

Prompts are **not hardcoded** — they are scenario/game data, with code fallbacks.

### 2.1 Runtime source (what the game actually uses)
- In-game: `server/data/games/<gameId>/prompts.json`
- Scenario template: `server/data/scenarios/<scenarioId>/prompts.json` (e.g. `default`)

Client reads via `GET /api/runtime/json/prompts` (`src/runtime/assets.js:92` →
`JSON_URLS.prompts`). Server resolves the `prompts` key on the **active game** (fallback to
its scenario).

### 2.2 `prompts.json` shape — normalized by `normalizePromptPack()` (`gameplayPrompts.js:412`)

| Key | Type | Use |
|---|---|---|
| `advisor` | string template | advisor system prompt (side panel) |
| `leader` | string template | diplomacy system prompt (polity chat) |
| `tasks` | map of templates | 12 structured JSON tasks (§5) |
| `helpers` | map of templates | reusable helper vars (`${...}` indirection) |

### 2.3 Code fallbacks (`gameplayPrompts.js`)
`PROMPT_ADVISOR_DEFAULT` (`:3`), `PROMPT_LEADER_DEFAULT` (`:28`), `PROMPT_TASK_DEFAULTS`
(`:57`, the 12 tasks), `PROMPT_HELPER_DEFAULTS` (`:194`), `PROMPT_SECTION_DEFINITIONS`
(`:232`, editor metadata).

### 2.4 Who edits prompts (UI)
The only prompt editor is **`src/Game/GameUI/libraryBar.jsx`**:
- `PromptSectionEditor` (`:256`) — per-section editor, uses `PROMPT_SECTION_DEFINITIONS`.
- `handlePromptChange` (`:1034`) — updates `editorState.prompts` (root `advisor`/`leader` or `tasks`).
- `handleHelperChange` (`:1053`) — updates `editorState.prompts.helpers`.
- `handleSave` (`:1075`) — `serializePromptPack()` then `saveScenario()`/`saveGame()` write `prompts.json`.

---

## 3. Template interpolation

Two identical engines (`main.jsx` for advisor/leader, `gameplay.js` for tasks):
1. `renderTemplate(template, vars)` — replaces `${key}` with the value (`main.jsx:472`, `gameplay.js:130`).
2. `resolveHelperValues()` (`main.jsx:478`, `gameplay.js:390`) — resolves helper templates in
   **2 passes**, so a helper can reference another.

**Two variable families:**
- **Base vars** — lowercase/camelCase (`playerPolity`, `date`…), computed in code.
- **Helpers** — UPPERCASE (`PLAYER_POLITY`…), plain aliases to a base var
  (`PLAYER_POLITY = "${playerPolity}"`, `gameplayPrompts.js:217`), user-editable. **Tasks use
  these by default.** Full alias table: `PROMPT_HELPER_DEFAULTS` (`gameplayPrompts.js:194`).

**Value sources:**
- Advisor/Leader: `buildPromptVariables()` (`main.jsx:598`) reads game/actions/chat/world/
  events/advisor in parallel (`main.jsx:665`) → synthetic texts (`buildWorldSummary`, etc.).
- Tasks: `buildTemplateVariables()` (`gameplay.js:405`) — richer superset: territory, polity
  overrides, catalyst, difficulty (`buildDifficultyGuidance`), player regions, etc.

---

## 4. The two conversations (advisor + leader)

In `src/Game/AI/main.jsx`. History kept **in memory** (module vars `advisorHistory` /
`diplomaticHistory`).

### 4.1 Advisor (strategic counsel)
- Prompt: `buildAdvisorSystemPrompt()` (`main.jsx:663`).
- API: `sendMessage` (`:718`), `startChat` (`:741`), `loadHistory` (`:732`).
- Consumer **`advisor.jsx`**: bootstrap `loadHistory`/`startChat` (`:181`,`:183`); send
  `handleSend`→`sendMessage` (`:209`); reset `startChat` (`:258`).

### 4.2 Leader (inter-polity diplomacy)
- Prompt: `buildDiplomaticSystemPrompt(countries, playerCountry)` (`main.jsx:687`).
- API: `sendDiplomaticMessage` (`:769`), `startDiplomaticChat` (`:748`), `loadDiplomaticHistory` (`:752`).
- Key logic: `sendDiplomaticMessage` adds a per-turn instruction (`turnInstruction`, `:774`)
  telling the LLM to answer as one polity and optionally append `REACTION:<emoji>`;
  `parseReaction` (`:761`) extracts the emoji.
- Consumer **`chat.jsx`**: bootstrap `loadDiplomaticHistory`/`startDiplomaticChat`
  (`:495`,`:496`); reply `fetchLeaderResponse`→`sendDiplomaticMessage` (`:514`); turn order
  `buildResponsiveQueue`→`chooseNextDiplomaticSpeaker` (`:552`).

---

## 5. Structured JSON tasks (`gameplay.js`)

Not chats: one-shot requests asking the LLM for **pure JSON**, parsed leniently with a
**deterministic fallback** on failure/timeout. No enforced schema.

Engine: `runJsonTask(taskKey, {...})` (`gameplay.js:503`) → load prompts, interpolate,
`callAI` with timeout (`withTimeout` `:480`), `extractJsonPayload` (`:105`: direct → ```json
fence → first `{...}` → first `[...]`), else `fallback()`.

| Exported fn (`gameplay.js`) | Task key | Consumer | Does |
|---|---|---|---|
| `generateActionSuggestions` (`:883`) | `actions` | actions.jsx `refreshSuggestions` (`:341`) | propose 4–7 action topics |
| `refinePlayerAction` (`:930`) | `descriptionToAction` | actions.jsx `handleImprove` (`:309`) | free text → structured action |
| `chooseNextDiplomaticSpeaker` (`:963`) | `nextSpeaker` | chat.jsx `buildResponsiveQueue` (`:552`) | pick next speaker |
| `consolidateRecentHistory` (`:995`) | `eventConsolidator` | (internal) | compress history for continuity |
| `createCatalyst` (`:1015`) | `catalystCreation` | (catalyst flow) | create a catalyst scene |
| `advanceActiveCatalyst` (`:1046`) | `catalystExecutor` + `catalystSummary` | (catalyst UI) | advance/resolve scene |
| `simulateTimelineJump` (`:1152`) | `jumpForward` | time.jsx `runJump` (`:1147`) | manual time skip |
| `simulateAutoJump` (`:1188`) | `autoJumpForward` | time.jsx `runJump` (`:1146`) | skip to next notable event |
| `applyGameMasterCommand` (`:1191`) | `gameMaster` | (GM UI) | direct map/state intervention |

### 5.1 Simulation core: `applySimulationResult` (`gameplay.js:803`)
Where LLM output becomes persisted state. Given a `result` (events, `stopDate`,
`clearActions`, `catalyst`): (1) normalize+append events; (2) advance date & `round`;
(3) mark planned actions `resolved` if `clearActions`; (4) create event-driven chats
(`buildGeneratedChat` `:672`); (5) apply map impacts (`applyEventImpactsToWorld` — region
transfers, polity renames/colors); (6) write **all in parallel** (`:864`): actions, chats,
events, game, colors, world. `simulateTimelineJump`, `advanceActiveCatalyst`,
`applyGameMasterCommand` all converge here.

---

## 6. LLM providers & dispatch

`src/Game/AI/main.jsx` + `providerConfig.js`.
- `callAI(systemPrompt, history, opts)` (`main.jsx:452`) dispatches on stored provider (`getStoredProvider`).
- 5 providers (`providerConfig.js:3`): `gemini`, `openai`, `anthropic`, `openai-compatible`, `server`.
- First four store apiKey/model/endpoint in **localStorage** (`PROVIDER_SETTINGS` `:41`); `server` stores only model `id`.
- Each call retries 3× on 429/503 (`callGemini` `:212`, `callAnthropic` `:393`,
  `callOpenAIStyleChatCompletions` `:267` — shared by openai/compatible/server).
- History canonical form is Gemini; `toOpenAIMessages` (`:143`), `toAnthropicMessages` (`:156`) convert it.

### 6.1 `server` provider (server-side key proxy)
- Client `callServerModel` (`main.jsx:374`) → `POST /api/llm/:modelId/chat/completions`.
- Server `server/aiProxy.js` `proxyChatCompletion(modelId, body)`: find model in
  `server/config/serverModels.json`, resolve upstream, read key from `process.env[apiKeyEnv]`
  (`.env`), forward to `${baseUrl}/chat/completions` with `Authorization: Bearer <key>`.
- `GET /api/config` exposes only `{id,label}` — never keys.
- Current catalog: upstreams `openrouter`+`openai`; models `or-llama-3.3-70b`,
  `or-qwen3.6-plus`, `or-deepseek-v4-pro`, `or-deepseek-v4-flash`.

---

## 7. Where data lives & how it persists

### 7.1 Disk layout (`server/data/`)
```
server/data/
├── scenario-manifest.json     # order + selected scenario
├── game-manifest.json         # activeGameId + order
├── scenarios/<scenarioId>/
│   ├── scenario.json          # template metadata
│   ├── game.json world.json prompts.json colors.json
│   ├── *.pmtiles              # map tiles (LFS)
│   └── storage/               # actions/chat/events/advisor seed
└── games/<gameId>/
    ├── game-instance.json     # instance metadata (scenarioId, …)
    ├── game.json              # live state: gameDate, round…
    ├── world.json             # polityOverrides, regionOwnershipOverrides, simulationHistory, activeCatalyst
    ├── actions.json chat.json events.json advisor.json prompts.json colors.json
    └── storage/
```

### 7.2 Which game is read/written
**Active game** = `game-manifest.json` `activeGameId`, set by `PUT /api/games/active` →
`setActiveGame()` (`server/libraryStore.js`). `readRuntimeJsonAsset(key)` /
`writeRuntimeJsonAsset(key, value)` operate on `server/data/games/<activeGameId>/<key>.json`
(read falls back to scenario).
> The **runtime token** (`?v=<token>` in `JSON_URLS`) is browser cache-busting only — it does
> not select the game; `activeGameId` does.

### 7.3 Runtime endpoints (`server/server.js`)
| Method | Path | Effect |
|---|---|---|
| GET | `/api/runtime/json/:key` | read active game's `<key>.json` (`Cache-Control: no-store`) |
| PUT | `/api/runtime/json/:key` | write `<key>.json` to active game, normalized |
| GET | `/api/runtime/pmtiles/:key` | stream tiles with HTTP range (206) |
| POST | `/api/llm/:modelId/chat/completions` | LLM proxy with server-side key |
| GET | `/api/config` | server model list (`{id,label}` only) |

### 7.4 Client data access
- `src/runtime/assets.js`: `readJson`/`writeJson` (`:225`,`:273`) to runtime endpoints; in-memory
  `Map` cache + browser Cache API (`pax-historia-preload-v1`) + request dedup. `JSON_URLS`
  populated by `setRuntimeAssetEndpoints({token})` (`:83`).
- `src/runtime/gameState.js`: typed wrappers + normalizers:

  | `JSON_URLS` | File | Read | Write | Normalizer |
  |---|---|---|---|---|
  | `world` | world.json | `readWorldState` | `writeWorldState` | `normalizeWorldState` |
  | `game` | game.json | `readGameData` | `writeGameData` | `normalizeGameData` |
  | `actions` | actions.json | `readActionsState` | `writeActionsState` | `normalizeActions` |
  | `events` | events.json | `readEventsState` | `writeEventsState` | `normalizeEvents` |
  | `chat` | chat.json | `readChatsState` | `writeChatsState` | `normalizeChats` |

  `readGameStateBundle({force})` reads actions/chats/events/game/world in parallel.
  `applyEventImpactsToWorld({colors, events, world})` applies event impacts to
  `regionOwnershipOverrides` & `polityOverrides` (+ colors).

---

## 7bis. Initializing the world (starting lore)

How to give the AI per-nation starting context (culture, historical friends/rivals) — and
what the code **actually reads**.

### 7bis.1 What survives `world.json` normalization
`normalizeWorldState` (`gameState.js:512`) keeps only `WORLD_DEFAULTS` fields (`gameState.js:12`).
Per nation, `normalizePolityOverride` (`gameState.js:473`) keeps **only** `code`, `name`,
`color`, `aliases`, `note`. A `description` field on a polity is **dropped**.

### 7bis.2 What actually reaches prompts
- `startingTimelineText` → helper `WORLD_BEFORE_ROUND_ONE_TEXT` → injected into **advisor,
  leader, and most tasks** (`gameplay.js:473`, `main.jsx:639`). **Primary lore channel.**
- `simulationRules` → helper `HISTORICAL_PRESET_SIMULATION_RULES` → same (`gameplay.js:469`).
- `polityOverrides`: the world summary (`buildWorldSummary`, `gameplay.js:240`) lists them
  only as `code: name (color) aliases …`. **`note`/`description` are NOT injected.**

> Therefore: **no structured per-nation field reaches the AI today.** Put lore as **free text**
> in `startingTimelineText`.

### 7bis.3 Path A — free text (no code, recommended)
Write the briefing into `world.json` `startingTimelineText` (one paragraph per power with
`Friends:`/`Rivals:` lines) and world rules into `simulationRules`.
- File: `server/data/scenarios/default/world.json` (applies to **new** games from it; a
  running game has its own `server/data/games/<id>/world.json`).
- ⚠️ Cost: `startingTimelineText` is attached to *every* LLM call. Cover ~10–20 relevant
  powers, not all states — small models (default `gemini-3.1-flash-lite`) bloat on tokens.

### 7bis.4 Path B — structured per-nation field (needs code)
For per-nation `description`/`friends`/`rivals` (UI-editable, map-showable):
(1) keep fields in `normalizePolityOverride` (`gameState.js:473`); (2) inject into
`buildWorldSummary` (`gameplay.js:240` **and** `main.jsx:585`); (3) optional editor in `libraryBar.jsx`.

### 7bis.5 Current `default` scenario state
Initialized via Path A: `world.json` has `startingTimelineText` (briefing of major powers at
1 Jan 2016 with allies/rivals) + `simulationRules`. Runtime state (events/chat/actions/
advisor/map overrides) stays empty — the AI builds history from `startDate`.

---

## 8. End-to-end flow (example: time skip)

1. `time.jsx` `runJump` → `simulateTimelineJump({days})` (`gameplay.js:1152`).
2. `readGameStateBundle({force:true})` reads current state.
3. `buildTemplateVariables` → `runJsonTask("jumpForward", …)` interpolates and calls the LLM.
4. JSON parsed (`extractJsonPayload`) or `fallbackJumpSimulation` (`:703`).
5. `applySimulationResult` (`:803`) advances date/round, resolves actions, spawns chats,
   applies map impacts, writes everything via `writeJson`.
6. `PUT /api/runtime/json/*` saves under `server/data/games/<activeGameId>/`.
7. Map (`Nations.jsx`, 5s polling) picks up new state and recolors.

---

## 8bis. Prompt variable reference

Syntax: `${name}` in any template. Substitution is **case-sensitive**; an unknown variable
renders as **empty string** (`renderTemplate`, `main.jsx:472` / `gameplay.js:130`).
Two families (§3): base vars (lowercase, code-computed) and helpers (UPPERCASE aliases,
user-editable, the task standard).

### 8bis.1 Helpers (UPPERCASE) — `PROMPT_HELPER_DEFAULTS` (`gameplayPrompts.js:194`)

| Helper | Alias of | Content |
|---|---|---|
| `PLAYER_POLITY` | `${playerPolity}` | player nation |
| `RESPONDING_POLITY_NAME` | `${respondingPolityName}` | polity replying (diplomacy) |
| `ORIGIN_ROUND_DATE` | `${date}` | current game date |
| `ORIGIN_ROUND_GRAMMATICAL_DATE` | `${dateReadable}` | readable date ("1 January 2016") |
| `STARTING_ROUND_DATE` | `${startDate}` | campaign start date |
| `TARGET_ROUND_DATE` | `${targetDate}` | target date (time skips) |
| `TARGET_ROUND_GRAMMATICAL_DATE` | `${targetDateReadable}` | readable target date |
| `WORLD_BEFORE_ROUND_ONE_TEXT` | `${worldBeforeRoundOne}` | starting briefing (`world.json` → `startingTimelineText`) |
| `HISTORICAL_PRESET_SIMULATION_RULES` | `${simulationRules}` | sim rules (`world.json` → `simulationRules`) |
| `GRAND_MAP_DESCRIPTION` | `${worldSummary}` | world summary |
| `GRAND_MAP_DESCRIPTION_NO_CITY` | `${worldSummaryNoCity}` | same (no city) — currently identical |
| `PLAYER_ACTIONS_THIS_ROUND` | `${plannedActions}` | this round's planned actions |
| `PLAYER_EVERY_ACTION` / `..._NOT_PREVIOUS` | `${allActions}` | all actions incl. resolved |
| `ALL_ADVISOR_MESSAGES` | `${advisorMessages}` | advisor chat history |
| `ALL_EVENTS_WITH_CONSOLIDATION` | `${recentEventsLong}` | recent events (long list) |
| `ALL_EVENTS_WITH_CONSOLIDATION_CATALYSTS` | `${recentEventsLong}` | same (catalyst) |
| `PREVIOUS_ROUND_EVENTS` | `${recentEvents}` | previous round's events |
| `CHATS_NON_CONSOLIDATED_ROUNDS` | `${chatHistoryLong}` | diplomacy history (multi-chat) |
| `THIS_CHAT_HISTORY` | `${chatHistory}` | current chat messages |
| `CHAT_PARTICIPANTS` | `${chatParticipants}` | current chat participants |
| `THIS_CHATS_MOST_RECENT_SPEAKER` | `${lastSpeaker}` | last speaker |
| `DIFFICULTY_DESCRIPTION_CHATS` | `${difficultyGuidanceChats}` | difficulty guidance (diplomacy) |
| `DIFFICULTY_DESCRIPTION_JUMP_FORWARD` | `${difficultyGuidanceJumpForward}` | difficulty guidance (skips) |
| `NON_CONSOLIDATED_ROUNDS_WITH_DATES` | `${recentRoundsWithDates}` | recent rounds with dates |
| `NUMBER_OF_REGIONS` | `${numberOfRegions}` | region count |
| `PLAYER_POLITY_REGIONS` | `${playerPolityRegions}` | player-owned regions |
| `PLAYER_POLITY_BATTALION_SUMMARIES` | `${playerBattalionSummaries}` | placeholder (light runtime) |
| `DESCRIPTION_ACTION_TEXT` | `${actionInput}` | raw action text (`descriptionToAction`) |
| `GAME_MASTER_PLAYER_REQUEST` | `${gameMasterRequest}` | GM request (`gameMaster`) |
| `EVENTS_TO_CONSOLIDATE` | `${eventsToConsolidate}` | events to compress |
| `RUNNING_CATALYST_DATE` | `${catalystDate}` | catalyst scene date |
| `RUNNING_CATALYST_PERCENT` | `${catalystPercent}` | catalyst progress (%) |
| `CATALYST_PREMISE_DESCRIPTION` | `${catalystPremise}` | catalyst premise |
| `CATALYST_SIMULATION_HISTORY` | `${catalystHistory}` | catalyst choice history |

> `CHATS_TO_CONSOLIDATE` is used in the `eventConsolidator` prompt but has **no** default in
> `PROMPT_HELPER_DEFAULTS`; the value `${chatsToConsolidate}` is supplied as a base var from
> `gameplay.js` (passed explicitly by `consolidateRecentHistory`).

### 8bis.2 Base vars (lowercase) — data source
Defined in `buildPromptVariables` (`main.jsx:598`, advisor/leader) and the superset
`buildTemplateVariables` (`gameplay.js:405`, tasks). Where: R = root (advisor/leader), T =
task, R+T = both.

| Var | Where | Content / source |
|---|---|---|
| `playerPolity` | R+T | `game.json` → `country` |
| `date` | R+T | `game.json` → `gameDate` |
| `startDate` | R+T | `game.json` → `startDate` |
| `targetDate` | R+T | target date (default = `gameDate`) |
| `difficulty` | R+T | `game.json` → `difficulty` (default "standard") |
| `language` | R+T | `world.json`/`game.json` → `language` (default "English") |
| `actions` | R | formatted planned actions (informal alias) |
| `plannedActions` | R+T | planned actions, or "No planned actions…" |
| `allActions` | R+T | all actions incl. resolved |
| `chat` | R | `JSON.stringify` of raw chats |
| `chatHistory` | R+T | current chat messages |
| `chatHistoryLong` | R+T | detailed multi-chat history |
| `chatParticipants` | R+T | current chat country names |
| `chatSummary` | T | chats digest |
| `lastSpeaker` | R+T | current chat's last speaker |
| `respondingPolityName` | R+T | replying polity (diplomacy) |
| `advisorMessages` | R+T | advisor history |
| `recentEvents` | R+T | recent events |
| `recentEventsLong` | R+T | recent events (extended) |
| `worldSummary` / `worldSummaryNoCity` | R+T | world summary |
| `worldBeforeRoundOne` | R+T | `world.json` → `startingTimelineText` |
| `simulationRules` | R+T | `world.json` → `simulationRules` |
| `difficultyGuidanceChats` | R+T | difficulty guidance (diplomacy) |
| `difficultyGuidanceJumpForward` | T | difficulty guidance (skips) |
| `dateReadable` / `targetDateReadable` | T | readable dates |
| `numberOfRegions` | T | region catalog count |
| `playerPolityRegions` | T | player regions |
| `playerBattalionSummaries` | T | placeholder (no military data in light runtime) |
| `recentRoundsWithDates` | T | recent rounds with date ranges |
| `actionInput` | R(="")+T | raw action text (`descriptionToAction` only) |
| `gameMasterRequest` | R(="")+T | GM request (`gameMaster` only) |
| `eventsToConsolidate` / `chatsToConsolidate` | T | text to compress |
| `catalystDate` `catalystPercent` `catalystPremise` `catalystHistory` `catalystChoice` `catalystOpening` | T | catalyst scene context |

> `actionInput` and `gameMasterRequest` exist on the root side too but are always `""` —
> meaningful only in their tasks.

### 8bis.3 Advisor/leader variable mismatch (RESOLVED)
The `default` `advisor`/`leader` prompts once used informal lowercase names, some
**nonexistent** → rendered empty:

| Prompt | Was | Issue | Fixed to |
|---|---|---|---|
| advisor | `${country}` | ❌ nonexistent | `${PLAYER_POLITY}` |
| advisor | `${startDate}` | ✅ ok (now consistent) | `${STARTING_ROUND_DATE}` |
| advisor | `${date}` | ✅ ok | `${ORIGIN_ROUND_DATE}` |
| leader | `${country}` | ❌ nonexistent | `${PLAYER_POLITY}` |
| leader | `${startdate}` | ❌ nonexistent (case!) | `${STARTING_ROUND_DATE}` |
| leader | `${date}` | ✅ ok | `${ORIGIN_ROUND_DATE}` |

Both also lacked world context, so the `world.json` briefing (§7bis) never reached them. Both
now include a "World context" block: `${WORLD_BEFORE_ROUND_ONE_TEXT}`,
`${HISTORICAL_PRESET_SIMULATION_RULES}`, and `${GRAND_MAP_DESCRIPTION}` (advisor) /
`${GRAND_MAP_DESCRIPTION_NO_CITY}` (leader). All placeholders now use UPPERCASE helpers,
consistent with tasks.

---

## 9. Quick file → responsibility map

| File | Responsibility |
|---|---|
| `src/Game/AI/providerConfig.js` | providers, keys/model in localStorage, dispatch config |
| `src/Game/AI/main.jsx` | `callAI`, advisor/leader conversations, prompt interpolation |
| `src/Game/AI/gameplay.js` | structured JSON tasks, simulation, persisting outcomes |
| `src/Game/AI/gameplayPrompts.js` | default prompts/helpers, normalize/serialize pack, editor metadata |
| `src/Game/GameUI/advisor.jsx` | advisor UI (consumer) |
| `src/Game/GameUI/chat.jsx` | diplomacy UI (consumer) |
| `src/Game/GameUI/time.jsx` | time-skip UI (consumer) |
| `src/Game/GameUI/actions.jsx` | actions/suggestions UI (consumer) |
| `src/Game/GameUI/libraryBar.jsx` | **prompt editor** (root + task + helper) |
| `src/runtime/assets.js` | JSON/binary access, caching, `JSON_URLS` |
| `src/runtime/gameState.js` | typed read/write + state normalizers |
| `server/server.js` | `/api` routes (runtime json, llm, config, CRUD) |
| `server/aiProxy.js` | LLM proxy with key from `.env` |
| `server/libraryStore.js` | scenario/game persistence, active game, runtime token |
| `server/config/serverModels.json` | managed model catalog (id/label/upstream) |
