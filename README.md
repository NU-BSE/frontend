# Creepy.IM — Android frontend

Expo SDK 57 + Expo Router + TanStack Query + TanStack AI. Android only, built
from the Creepy.IM Figma file.

## Status

| Area | State |
| --- | --- |
| Onboarding (categories → memory config) | Built from Figma |
| Feed / Home (tabs, scenario cards) | Built from Figma |
| History (search, sort, filters, entries) | Built from Figma |
| Auth (screen 3) | Built; providers stubbed |
| Ask Creepy chat | Built — **no Figma frame existed**, designed to match |
| Deep links | Live code paths, **stub targets** |
| AI layer (on-device, swappable) | Done, verified against a real `ChatClient` |

`tsc` clean · `expo lint` clean · `expo-doctor` 20/20 · Android bundle exports.

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
npm run verify         # everything below, in order
npm run verify:ai      # drives a real ChatClient through the custom connection
npm run verify:logic   # history sort / filter / search pipeline
npm run verify:layout  # runs Yoga over the category grid's real node tree
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

## Layout

```
app/
  _layout.tsx            Fonts + providers: Gesture → SafeArea → Query → Ai
  index.tsx              Gate: onboarding vs feed
  onboarding/
    index.tsx            Support categories (multi-select grid)
    memory.tsx           Memory config (radio rows)
  (tabs)/
    feed.tsx             Home: tab selector + scenario cards
    history.tsx          Search, category filters, entry cards
    auth.tsx             Providers + engine status
  chat.tsx               Ask Creepy — modal over the tabs
src/
  ai/                    Engines, connection adapter, provider, hook
  components/            Text, Screen, Button, Icon, TopAppBar, TabSelector
  features/
    scenarios/registry   ← one file drives four surfaces
    chat/                Bubbles, chips, composer, deep links
  storage/               AsyncStorage repositories
  auth/providers.ts      Registry for the Telegram/Google/Facebook work
  theme/tokens.ts        ← the whole design system
assets/icons/            23 Figma SVG exports
```

## Still to do

**Auth.** `src/auth/providers.ts` defines the shape; buttons render disabled with
the reason. Implementing one means writing `signIn` and flipping `enabled`.
Tokens go in `expo-secure-store` (installed), never AsyncStorage.

**Real deep-link targets.** Replace the `url` values in the registry.

**Loading skeleton.** The Figma file has a Home loading state (`0:123`) that is
not built — the current Home has no async fetch to wait on, so a skeleton would
be decorative. Worth adding when real feed data arrives.

## Known npm quirk

`expo-router` pulls web-only deps (`vaul` → `react-dom@19.2.8`) whose peer range
does not match the `react@19.2.3` Expo pins. Irrelevant to an Android-only app,
but it blocks a strict `npm install`. Use `--legacy-peer-deps`.
