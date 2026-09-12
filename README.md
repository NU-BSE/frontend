# Creepy.IM

**An open-source, local-first AI assistant for Android that can use tools, connect to your apps, and perform actions on your behalf — while keeping you in control.**

Creepy.IM is an experiment in moving AI assistants beyond chat.

Instead of only answering questions, Creepy can understand a task, decide which tools are needed, interact with connected services through MCP, and execute actions after explicit user approval.

The project is designed around a simple idea:

> **An AI assistant should be able to act — without becoming an uncontrolled agent.**

Creepy can run AI models directly on the device, use cloud inference when requested, connect to external services, and expose those capabilities to an agent through a permission-aware tool layer.

The project is currently focused on Android.

---

## What Creepy can do

Creepy is built around an agent runtime rather than a traditional chatbot.

A request can look like:

```text
Find the conversation where we discussed the trip and remind me tomorrow.
```

Instead of treating that as a single prompt, the agent can:

```text
Understand the request
        ↓
Choose available tools
        ↓
Read relevant information
        ↓
Prepare an action
        ↓
Ask for approval when required
        ↓
Execute the action
        ↓
Return the result
```

The same architecture can be extended to messaging, calendars, files, productivity tools, device capabilities and other services.

---

## Core principles

### Local-first AI

Creepy supports on-device inference through `llama.rn`.

The UI and agent runtime are model-agnostic, so inference can be switched between:

* on-device models;
* remote models;
* an offline development / preview engine.

The goal is to keep local execution possible instead of making the application permanently dependent on a cloud LLM.

### Tools, not just chat

The agent can interact with real capabilities through a connector system built around MCP.

```text
User
  ↓
Creepy UI
  ↓
Agent Runtime
  ↓
LLM / Planner
  ↓
MCP
  ↓
Policy & Approval Layer
  ↓
Connector
  ↓
External service / Android
```

Connectors are isolated from the model itself.

The model decides **what it wants to do**.

The tool layer decides **whether and how that action can actually happen**.

### Human approval

Actions with external side effects can require explicit confirmation.

For example, reading data and sending a message are treated differently.

The model cannot approve its own actions.

Approval happens in the application layer before the connector is allowed to execute the operation.

### Credentials stay outside the model

Credentials are referenced by the connection layer and stored separately from model context.

The agent receives tools and tool results — not OAuth secrets, refresh tokens or account passwords.

### Honest capabilities

A connector should not pretend that an operation succeeded when the real provider implementation is unavailable.

Development mocks are useful for testing, but production capabilities are registered separately from mocked ones.

---

## Architecture

Creepy is primarily composed of five layers.

```text
┌──────────────────────────────────────┐
│             React Native UI          │
└─────────────────┬────────────────────┘
                  │
┌─────────────────▼────────────────────┐
│             Agent Runtime            │
│                                      │
│  planning → tools → results → answer │
└───────────┬──────────────────────────┘
            │
┌───────────▼──────────────────────────┐
│                MCP                   │
│                                      │
│ tool registry / validation / policy  │
└───────────┬──────────────────────────┘
            │
┌───────────▼──────────────────────────┐
│          Connector Layer             │
│                                      │
│ Google / Telegram / Android / ...    │
└───────────┬──────────────────────────┘
            │
┌───────────▼──────────────────────────┐
│        External capabilities         │
└──────────────────────────────────────┘
```

The AI engine is intentionally replaceable:

```text
                    ┌─ On-device LLM
                    │
Agent Runtime ──────┼─ Remote LLM
                    │
                    └─ Development engine
```

---

## Tech stack

Creepy currently uses:

* React Native
* Expo
* Expo Router
* TypeScript
* TanStack Query
* TanStack AI
* Model Context Protocol (MCP)
* `llama.rn`
* Zod
* Expo SecureStore
* React Native AsyncStorage

The repository is structured as a monorepo, with reusable agent, MCP and connector packages living alongside the application.

---

## Repository structure

```text
app/
  Android application screens and routing

src/
  agent/
      agent runtime, planners and tool execution

  ai/
      local / remote AI engines and adapters

  connections/
      persistent connection management

  mcp/
      MCP runtime and tool registration

  features/
      application features and UI flows

  storage/
      persistent application storage

packages/
  connector-core
  connector-google
  connector-telegram
  connector-android
  connector-github
  connector-slack
  connector-discord
  connector-notion
  connector-dropbox
  connector-spotify
  connector-todoist
  mcp-client
  mcp-server
  approval-core
  policy-core
  credential-vault
  ...

modules/
  native Android modules

scripts/
  architecture and integration verification scripts

test/
  tests
```

---

## Getting started

### Requirements

You will need:

* Node.js
* npm
* Android Studio / Android SDK
* an Android emulator or physical Android device

Clone the repository and install dependencies:

```bash
git clone <repository-url>
cd frontend

npm install --legacy-peer-deps
```

Create your environment configuration:

```bash
cp .env.example .env
```

Then run the Android application:

```bash
npm run android
```

---

## Environment

The application can run with different levels of external integration.

The important configuration groups are:

```env
EXPO_PUBLIC_API_URL=

EXPO_PUBLIC_LLM_ENGINE=
EXPO_PUBLIC_LLM_MODEL_PATH=

EXPO_PUBLIC_TELEGRAM_ADAPTER=
EXPO_PUBLIC_TELEGRAM_API_ID=
EXPO_PUBLIC_TELEGRAM_API_HASH=

EXPO_PUBLIC_MCP_RUNTIME_MODE=
```

Do not commit personal credentials.

If you want to use Telegram through the native connector, create your own Telegram application credentials.

Some cloud functionality may require the Creepy.IM backend or your own compatible backend implementation.

---

## On-device AI

Creepy supports running GGUF models directly on Android through `llama.rn`.

A model can be configured with:

```env
EXPO_PUBLIC_LLM_ENGINE=on-device
EXPO_PUBLIC_LLM_MODEL_PATH=/path/to/model.gguf
```

The agent and UI do not depend directly on a specific model implementation.

That means the inference layer can evolve independently from the rest of the application.

---

## MCP and connectors

Connectors expose capabilities to the agent as tools.

Conceptually:

```text
Connector
   ↓
Tool definitions
   ↓
MCP registry
   ↓
Agent
```

A connector may provide operations such as:

```text
search_messages
read_calendar
find_files
create_event
send_message
change_device_setting
```

The agent never calls provider APIs directly.

This boundary allows Creepy to apply validation, permissions and user approvals before an operation reaches the external service.

Some connectors are still experimental or development-only.

The connector system is one of the main areas where contributions are welcome.

---

## Approval model

Creepy distinguishes between actions that can happen automatically and actions that should require the user.

For example:

```text
Read calendar
      ↓
allowed

Send message
      ↓
approval required
      ↓
user approves
      ↓
execute
```

Approval requests are bound to the action being approved so that the model cannot silently replace the requested operation after confirmation.

---

## Development

Type-check the project:

```bash
npm run typecheck
```

Run linting:

```bash
npm run lint
```

Run tests:

```bash
npm test
```

Run the full verification suite:

```bash
npm run verify
```

The repository also contains focused verification commands for major subsystems:

```bash
npm run verify:ai
npm run verify:mcp
npm run verify:agent
npm run verify:connections
npm run verify:telegram
npm run verify:google
npm run verify:gmail
npm run verify:on-device
npm run verify:custom-mcp
```

---

## Project status

Creepy.IM is under active development.

The core architecture is already implemented, including:

* agent orchestration;
* MCP tool execution;
* human approval flow;
* persistent connections;
* local and remote AI engine abstraction;
* on-device model integration;
* connector architecture;
* Android-native capabilities;
* automated architecture and integration checks.

However, not every connector or capability should currently be considered production-ready.

Expect APIs, interfaces and project structure to evolve.

---

## Roadmap

Some of the areas we want to explore next:

* more production-ready connectors;
* better on-device models;
* richer Android system integration;
* custom MCP servers;
* improved agent planning;
* stronger permission and policy controls;
* better local memory;
* multi-step background workflows;
* desktop and other platforms;
* easier self-hosting;
* community-built connectors.

The long-term goal is to make Creepy a platform where developers can add capabilities without having to redesign the agent itself.

---

## Contributing

Contributions are welcome.

There are many ways to help:

* implement a connector;
* improve Android integrations;
* add tests;
* improve local model support;
* work on the agent runtime;
* improve documentation;
* report bugs;
* propose new tools and capabilities;
* improve security and permission boundaries.

Before submitting a large architectural change, opening an issue to discuss the idea is recommended.

More detailed contribution guidelines will be added to `CONTRIBUTING.md`.

---

## Security

Creepy interacts with personal accounts and device capabilities, so security boundaries are a core part of the architecture.

If you discover a security vulnerability, please do **not** publish credentials, access tokens or personal user data in a public GitHub issue.

A dedicated security disclosure process will be documented in `SECURITY.md`.

---

## Why open source?

Personal AI agents are becoming capable of accessing increasingly sensitive parts of our digital lives.

That makes transparency important.

We want the architecture behind Creepy — its tools, permissions, connectors and agent behavior — to be inspectable, testable and improvable by other developers.

Open sourcing Creepy is also an invitation to experiment with a larger question:

**What should a personal AI agent look like when the user — not the model — is ultimately in control?**

---

## License

Creepy.IM is licensed under the **GNU General Public License v3.0**.

See [LICENSE](LICENSE) for details.
