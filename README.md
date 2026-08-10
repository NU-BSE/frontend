# Creepy.IM — Android frontend

Expo SDK 57 + Expo Router + TanStack Query + TanStack AI. Android only, built
from the Creepy.IM Figma file.

## Status

| Area | State |
| --- | --- |
| Onboarding (categories → memory config) | Built from Figma |
| Feed / Home (tabs, scenario cards) | Built from Figma |
| History (search, sort, filters, entries) | Built from Figma |
| Auth (email code) | Built and wired to the backend |
| Ask Creepy chat | Built — **no Figma frame existed**, designed to match |
| Deep links | Live code paths, **stub targets** |
| AI layer (on-device, swappable) | Done, verified against a real `ChatClient` |
| Agent orchestration (LLM ↔ MCP tool loop) | Done, verified end-to-end |
| Approvals UI (human confirmation gate) | Done, verified |
| Connection model (persistent store + registry) | Done, verified |
| Telegram personal connector | **Mock adapter**; native TDLib bridge stubbed (needs dev build) |
| Google / Microsoft / Slack / … connectors | **Mock** — hidden in production until real |

`tsc` clean · `expo lint` clean · `expo-doctor` 20/20 · Android bundle exports.

### Implementation status legend

Every connector package exports an honest `implementationStatus`, and the
production registry refuses to register `mock` connectors, so the model can
never be shown tools that would report fake success.

- **Implemented and real** — agent orchestration, approval flow, connection
  store/registry, email auth, MCP runtime.
- **Implemented but mock** — all provider connectors (Telegram, Google,
  Android, …) plus the built-in calendar. They exercise the full loop in
  development and tests but are not registered in production.
- **Requires native development build** — Telegram personal-account support
  (TDLib via the `TelegramTdlibModule` native module, Phase D). The
  TypeScript adapter seam and auth state machine exist; the Kotlin/TDLib side
  does not yet.
- **Requires backend / OAuth broker** — real Google OAuth token exchange and
  any provider with a confidential client secret. Never bundled in the APK.

## Run

```bash
npm install --legacy-peer-deps   # see "Known npm quirk"
cp .env.example .env
npm run android
```

Verification:

```bash
npm run typecheck
npm run lint
npm run verify               # everything below, in order
npm run verify:ai            # drives a real ChatClient through the custom connection
npm run verify:logic         # history sort / filter / search pipeline
npm run verify:layout        # runs Yoga over the category grid's real node tree
npm run verify:device        # attested device → model-profile selection
npm run verify:mcp           # in-process MCP runtime + approval round-trips
npm run verify:agent         # the full agent loop: plan → tool → approve → execute
npm run verify:connections   # connection truthfulness (no fake connections)
```

`verify:layout` matters more than it looks. The category grid collapsed to one
column twice: first from `maxWidth: 48.5%` plus a 16pt `gap` exceeding 100%, then
because a *correct* arithmetic test was passing while the structure it described
was not what rendered. The grid now uses explicit rows of `flex: 1` cells — the
column count is structural, so it cannot depend on measurement — and the test
computes real frames with Yoga, the same engine RN uses. It includes the old
broken structure as a control and asserts that it still collapses, so the harness
is proven able to tell the two apart.

## History sorting

Chronological order is the primary axis — History is a log, and "when" is the
question people bring to it. Category is an optional narrowing on top.

The filter glyph in the search field is the sort control (the Figma asset is a
funnel, not a magnifier, so it drives sorting rather than sitting decorative). It
tints brand-blue with a wash background when the order is non-default, and the
current order is spelled out in words below the category chips — an icon alone
cannot tell you *which* direction is active.

Filtering, searching and sorting all run through `applyHistoryView` in
`src/features/history/sort.ts`, so the list and the "N of M" count can never
disagree. It copies before sorting: the array comes from the Query cache, and
reordering it in place would reshuffle data under other subscribers.

## Design decisions you should know about

**The Figma file is not token-driven.** `get_variable_defs` returns `{}`, so
every value came from raw hex — and the three screen families disagreed:

| | Home | History | Onboarding |
| --- | --- | --- | --- |
| Blue | `#094cb2` | `#0055ff` | `#0041c8` |
| Serif | Noto Serif | Noto Serif | Source Serif 4 |
| Label face | Public Sans | Public Sans | JetBrains Mono |

Normalised to **Home's palette** by decision. Reversing that means editing
`palette.brand` and `fontFamily` in `src/theme/tokens.ts` — nothing else, because
no screen hardcodes a hex or a font size.

**There is no chat frame in Figma.** The Ask Creepy screen was designed to match
the system (same surfaces, radii, type scale) rather than invented freely, but it
is the one screen with no design to check against.

**Icons are Figma exports, not redraws.** All 23 SVGs in `assets/icons/` came out
of the file, rewritten to `fill="currentColor"` so a `color` prop can tint them —
which is what active/inactive nav states need. Non-square glyphs pass an explicit
height so they keep their designed aspect ratio. Two exceptions:

- The unselected radio in Memory Config has no asset in the export, so it is
  drawn as a bordered `View`.
- **The mascot is a supplied vector, not a Figma export.** In Figma it is a
  *bitmap* — asking for an SVG returns a wrapper around an embedded base64
  raster with zero paths, so there was nothing to tint.
  `assets/icons/creepy-mascot.svg` is the vector traced outside the file; the
  only change made here was `fill="#000000"` → `fill="currentColor"` so the
  `color` prop drives it. It renders brand-blue in the onboarding frame and the
  header pill. Replacing it means dropping in a new SVG with `currentColor`
  fills — no code change.

## The scenario registry

`src/features/scenarios/registry.ts` is the spine. One entry drives four
surfaces:

- the onboarding category grid
- the Home tab selector
- the Home scenario cards
- the chat's suggestion chips and deep links

Adding a scenario is one object. No screen changes.

## The chat

Opened from the "Ask Creepy" header pill (unscoped) or from a scenario card or
tab (scoped: `/chat?scenario=sports`). It presents both halves the brief asked
for — tappable suggestion chips *and* free-text input — plus a deep-link row.

Suggestions stay visible after the first exchange rather than disappearing; a
conversation in progress still benefits from a nudge.

### Deep links are stubs, deliberately live

`src/features/chat/deepLinks.ts` tries the real app scheme, then a web fallback,
and only then shows an inline "not wired up yet" notice. The buttons are not
disabled. The reasoning: a disabled button teaches the user nothing and has to be
rewired later, whereas this path starts working the moment a real target replaces
the stub in the registry — no code change.

## The AI architecture

The brief asked for an on-device model *through* TanStack AI. Not a conflict:

```
UI  ──►  useChat (@tanstack/ai-react)  ──►  ConnectionAdapter  ──►  engine
                    │                              │
        screens only ever see this      this is the swappable part
```

`ConnectionAdapter` is normally an HTTP transport. TanStack AI also exports
`stream(factory)`, taking any `AsyncIterable<StreamChunk>` — the documented seam
for non-HTTP transports. `src/ai/engineConnection.ts` uses it to run inference
in-process and emit a protocol-correct AG-UI event stream:

```
RUN_STARTED → TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT×N → TEXT_MESSAGE_END → RUN_FINISHED
```

- No server, no network, no API key needed for the app to work.
- Screens are engine-agnostic; moving to a hosted model is a change in
  `resolveEngine()`, not in any screen.
- `npm run verify:ai` drives a real `ChatClient` through this connection and
  asserts the message assembles and the loading state resolves. A hand-built
  event stream can look right and still hang the client — that script is what
  rules it out. It caught exactly that class of bug during development.

### Engines

| Engine | File | When it runs |
| --- | --- | --- |
| On-device | `src/ai/engines/onDeviceEngine.ts` | `EXPO_PUBLIC_LLM_MODEL_PATH` set **and** `llama.rn` present |
| Offline preview | `src/ai/engines/stubEngine.ts` | Fallback, and the default in Expo Go |
| Remote | TanStack AI's `xhrHttpStream` | Only when `EXPO_PUBLIC_LLM_ENGINE=remote` |

`llama.rn` is imported lazily inside a `try/catch` — it is a native module that
does not exist in Expo Go or before `expo prebuild`, and a static import would
crash the bundle for anyone who has not built yet. `AiProvider` degrades to the
preview engine **with a visible reason** rather than leaving a chat that silently
never answers.

### Enabling real on-device inference

```bash
npm install llama.rn
npx expo prebuild --platform android
# push a GGUF to the device, then set EXPO_PUBLIC_LLM_MODEL_PATH
```

The Memory Config onboarding step already collects the user's intended size
(512MB / 1B / 1.5B / cloud-only) into `getMemoryProfile()` — wire that to model
selection when you ship real weights. Start with Q4_K_M; `n_gpu_layers` defaults
to 0 because GPU offload is inconsistent across Android GPUs.

## The agent architecture

Chat is not text-in/text-out. `app/chat.tsx` talks to one hook —
`useAgentChat` — and the agent layer (`src/agent/`) owns the loop:

```
user message
   ↓
AgentRuntime (bounded loop, ≤ MAX_AGENT_STEPS)
   ├─► AgentModel (planner)            → validated tool call
   ├─► MCP client → MCP server          → policy + approval gate
   ├─► ConnectorRegistry → connector    → provider (Telegram, …)
   └─► tool result back to the planner  → final answer
```

Division of labor, enforced by construction:

- **The LLM plans actions.** It never executes anything and never sees
  credentials. Tool calls are Zod-validated before MCP.
- **MCP executes tools.** `registerConnectorTools` resolves the connection
  from `input.connectionId` at execution time, so one tool name serves many
  accounts (Google personal + work).
- **The UI owns human approval.** External side effects and destructive
  actions pause the run and surface `ApprovalSheet`. Approving re-invokes the
  tool with the byte-identical payload plus the approval id — the approval
  service hashes the arguments, so a tampered or replayed payload fails. The
  model has no tool that approves actions; it cannot approve its own side
  effect. Cancelling returns a structured `user_denied` result.
- **Credentials stay outside the model.** Connection records carry a
  `credentialReference`, never a secret. Secrets live in the CredentialVault
  (expo-secure-store / Android Keystore on-device).

### Planners

| Planner | When | Notes |
| --- | --- | --- |
| Structured planner | on-device engine | Strict JSON protocol over the text engine; every response Zod-validated. Unparseable output degrades to a text answer — never a guessed tool call. |
| Deterministic planner | offline-preview stub | Drives the full loop (search chat → send → approve → confirm) so the vertical slice is demoable without weights. |
| Text-only | remote engine | No tool contract with the backend yet; chat degrades honestly instead of faking tool use. |

### Connections are real

`src/connections/` reads and writes the persistent `ConnectionStore`
(AsyncStorage metadata; versioned document). The UI, the MCP registry and
connector auth flows all share it — there is no separate "UI connection
state". A fresh install exposes **no** external tools; only a completed auth
flow creates `status: connected`; disconnect removes the record and revokes
the stored credential; the MCP runtime restarts so the tool list always
matches reality. `npm run verify:connections` proves all of it.

In development mode the runtime seeds clearly labeled `(development mock)`
accounts so the loop is exercisable; production never seeds anything.

## Layout

```
app/
  _layout.tsx            Fonts + providers: Gesture → SafeArea → Query → Ai → Agent
  index.tsx              Gate: onboarding vs feed
  onboarding/
    index.tsx            Support categories (multi-select grid)
    connections.tsx      Connect services (real connection state)
    memory.tsx           Memory config (radio rows)
  (tabs)/
    feed.tsx             Home: tab selector + scenario cards
    history.tsx          Search, category filters, entry cards
    auth.tsx             Account + connectors + engine status
  chat.tsx               Ask Creepy — modal over the tabs (agent chat)
  dev/diagnostics.tsx    MCP health, tools, connections, model capabilities
src/
  agent/                 AgentRuntime, planners, tool mapper/executor, hooks
  ai/                    Engines, connection adapter, provider, hook
  components/            Text, Screen, Button, Icon, TopAppBar, TabSelector
  connections/           ConnectionService + TanStack Query hooks
  features/
    approvals/           ApprovalSheet + human-readable previews
    scenarios/registry   ← one file drives four surfaces
    chat/                Bubbles, chips, composer, deep links, tool labels
    connections/         ConnectorList (shared by onboarding + account)
  mcp/                   Runtime singleton, registry factory, dev seed, app deps
  storage/               AsyncStorage repositories
  auth/providers.ts      Registry mapping providers → connector ids
  theme/tokens.ts        ← the whole design system
packages/                @mobile-agent/* workspace packages (MCP + connectors)
assets/icons/            23 Figma SVG exports
```

## Still to do

**Telegram TDLib native bridge (Phase D).** The TypeScript seam
(`packages/connector-telegram/src/tdlib/`) and the phone/code/2FA auth state
machine are in place; the Kotlin `TelegramTdlibModule` + TDLib build is not.
Until then, `connect('telegram-user')` in production reports exactly that.

**Interactive Telegram auth screen.** The state machine lives in the adapter;
the phone/code/2FA UI flow needs a screen (Phase D).

**Real provider implementations.** Google (OAuth → Calendar → Gmail → People →
Drive → Tasks) is next, per `FINISH_FRONTEND_AGENT.md`. Everything else stays
mock until it is real — never a fake success.

**Real deep-link targets.** Replace the `url` values in the registry.

**Loading skeleton.** The Figma file has a Home loading state (`0:123`) that is
not built — the current Home has no async fetch to wait on, so a skeleton would
be decorative. Worth adding when real feed data arrives.

## Known npm quirk

`expo-router` pulls web-only deps (`vaul` → `react-dom@19.2.8`) whose peer range
does not match the `react@19.2.3` Expo pins. Irrelevant to an Android-only app,
but it blocks a strict `npm install`. Use `--legacy-peer-deps`.
