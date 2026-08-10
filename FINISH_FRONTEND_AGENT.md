# FINISH_FRONTEND_AGENT.md

## Mission

Finish the `NU-BSE/frontend` application as a real Android AI agent frontend.

Do **not** only review the repository or produce another TODO list. Implement the missing pieces in small, verifiable steps.

The most important end-to-end target is:

```text
User message
    ↓
Chat UI
    ↓
LLM / planner
    ↓
MCP tool selection
    ↓
Local MCP Client
    ↓
Local MCP Server
    ↓
Policy + approval
    ↓
Real connector
    ↓
Telegram / Google / Android API
    ↓
Tool result
    ↓
LLM
    ↓
Final assistant response
```

The first production-quality vertical slice must be:

```text
"Напиши Данияру в Telegram, что буду через 20 минут"
```

Expected behavior:

1. The LLM understands that Telegram is required.
2. The LLM searches Telegram chats/contacts.
3. The correct chat is resolved.
4. The LLM requests `telegram.user.send_message`.
5. The frontend displays a human-readable approval UI before sending.
6. The user confirms.
7. MCP executes the approved tool exactly once.
8. Telegram sends the real message.
9. The tool result is returned to the LLM.
10. The assistant answers that the action succeeded.

---

# 1. Repository state discovered during audit

The repository already contains substantial infrastructure. Preserve it unless there is a concrete reason to change it.

Current stack:

- Expo SDK 57
- React Native
- Expo Router
- TanStack Query
- TanStack AI
- local MCP Client
- local MCP Server
- `InMemoryTransport`
- connector registry
- policy engine
- approval service
- multiple connector workspace packages
- on-device/stub/remote LLM abstraction
- email authentication
- Android native attestation code

Important existing paths:

```text
app/chat.tsx
src/ai/
src/mcp/
src/auth/
packages/connector-core/
packages/connector-registry/
packages/connector-telegram/
packages/connector-google/
packages/connector-android/
packages/mcp-client/
packages/mcp-server/
packages/approval-core/
packages/policy-core/
packages/credential-vault/
packages/oauth-core/
scripts/verify-mcp.mts
IMPLEMENT_ALL_CONNECTORS.md
LOCAL_MCP_SETUP.md
```

Do not duplicate these systems.

---

# 2. Critical finding: Chat and MCP are not connected

Currently the chat path is essentially:

```text
Chat UI
  ↓
useCreepyChat()
  ↓
TanStack useChat()
  ↓
AiProvider
  ↓
engineConnection
  ↓
LLM
```

MCP runs separately through a development-only debug button.

Relevant files:

```text
app/chat.tsx
src/ai/useCreepyChat.ts
src/ai/AiProvider.tsx
src/ai/engineConnection.ts
src/mcp/McpDebugButton.tsx
src/mcp/runtime-singleton.ts
```

This is the biggest missing feature.

## Required change

Create a real agent orchestration layer.

Suggested location:

```text
src/agent/
  AgentRuntime.ts
  AgentProvider.tsx
  useAgentChat.ts
  toolMapper.ts
  toolExecutor.ts
  approval.ts
  types.ts
```

Do not let screens call MCP directly.

The UI should use one agent-facing hook:

```ts
const agent = useAgentChat(...)
```

The agent layer owns:

- conversation messages;
- available MCP tools;
- LLM requests;
- tool calls;
- tool results;
- approval interruptions;
- cancellation;
- max-step protection;
- errors.

---

# 3. Implement the LLM ↔ MCP tool loop

At the beginning of an agent run:

```ts
const runtime = await getLocalMcpRuntime();
const mcpTools = await runtime.mcp.listTools();
```

Map MCP tool definitions into the tool format understood by the selected LLM/planner.

Then implement a bounded loop conceptually equivalent to:

```ts
while (step < MAX_AGENT_STEPS) {
  const response = await llm(messages, tools);

  if (!response.toolCalls.length) {
    return response.finalText;
  }

  for (const toolCall of response.toolCalls) {
    const result = await mcp.callTool(toolCall);

    messages.push(toolCallMessage);
    messages.push(toolResultMessage);
  }
}
```

Requirements:

- maximum agent steps, e.g. 8-12;
- cancellation via `AbortSignal`;
- do not silently retry side-effectful actions;
- preserve tool calls and tool results in conversation state;
- tool errors must be returned to the model in a structured form;
- malformed tool arguments must not crash the app;
- never expose OAuth tokens or secrets to the model.

---

# 4. Fix the current text-only engine bridge

`src/ai/engineConnection.ts` currently converts messages into plain text prompts and intentionally drops tool-call/tool-result parts.

That means the current local LLM path cannot be a real tool-using agent.

Refactor the AI abstraction so that there are two separate capabilities:

```ts
interface LlmCapabilities {
  textGeneration: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
}
```

and an agent-facing model interface such as:

```ts
interface AgentModel {
  run(input: {
    messages: AgentMessage[];
    tools: AgentToolDefinition[];
    signal?: AbortSignal;
  }): Promise<AgentModelResult>;
}
```

Possible implementations:

```text
Remote tool-capable model
Local structured planner
Stub/test planner
```

Do not pretend that a plain text completion is a native tool call.

If the local `llama.rn` model does not provide native function calling, implement a strict structured planner protocol with schema validation rather than parsing arbitrary prose.

Example model output:

```json
{
  "type": "tool_call",
  "tool": "telegram.user.search_chats",
  "arguments": {
    "connectionId": "telegram-user-...",
    "query": "Данияр"
  }
}
```

Validate every planner response with Zod before MCP execution.

---

# 5. Add an approval UI to the real chat flow

The backend MCP approval mechanics already exist.

`registerConnectorTools()` can return:

```json
{
  "status": "approval_required",
  "approvalId": "...",
  "preview": {}
}
```

and `approveConnectorTool(approvalId)` exists.

What is missing is the actual user experience.

Create an approval component, for example:

```text
src/features/approvals/
  ApprovalSheet.tsx
  ApprovalPreview.tsx
  approvalText.ts
```

For Telegram it should show something similar to:

```text
Send Telegram message?

To:
Daniyar

Message:
Буду через 20 минут

[Cancel] [Send]
```

For other tools render useful fields:

- email recipient / subject / body;
- calendar title / time / attendees;
- file name / destination;
- destructive action target.

Rules:

- external side effects require explicit confirmation;
- destructive actions require explicit confirmation;
- approval must remain bound to the exact payload;
- cancelling must return a tool result such as `user_denied`;
- an approval cannot be reused;
- the LLM must not be able to approve its own action.

---

# 6. Connection state is currently fake

Both:

```text
app/onboarding/connections.tsx
app/(tabs)/auth.tsx
```

currently store connector state in local React `useState`.

Pressing a button only changes the label to `Connected`.

Replace this with real connection state.

The UI must read from a persistent connection service:

```ts
interface ConnectionService {
  list(): Promise<ConnectionRecord[]>;
  connect(connectorId: ConnectorId): Promise<ConnectionRecord>;
  disconnect(connectionId: string): Promise<void>;
  reconnect(connectionId: string): Promise<void>;
}
```

Use TanStack Query for UI synchronization.

Suggested query keys:

```ts
['connections']
['connections', connectorId]
```

Mutations must invalidate the relevant connection queries.

The same source of truth must be used by:

- onboarding;
- Account / Connectors;
- MCP tool registration;
- connector auth flows.

There must never be one connection state in UI and a different connection state in MCP.

---

# 7. Replace mock connections

`packages/connector-core/src/mock-helper.ts` currently creates every mock connection with:

```ts
status: 'connected'
```

As a result, the registry can expose tools for services the user has never connected.

This must not happen in production.

Mocks may remain for tests, but production runtime must not use `mockConn()`.

Add an explicit environment/runtime separation:

```text
development tests → mock connectors allowed
production app    → real connectors only
```

For example:

```ts
createConnectorRegistry({
  mode: 'production',
  connectionStore,
  credentialVault,
  ...
})
```

Do not expose a Telegram/Gmail/etc tool to the model unless a matching connected account exists.

---

# 8. Implement a persistent ConnectionStore

`packages/connector-core/src/store.ts` currently defines only an interface.

Implement a real Android persistence layer.

Requirements:

- persists across app restarts;
- supports multiple accounts per provider;
- does not store raw OAuth secrets;
- stores `credentialReference`, not credentials;
- connection statuses survive restart;
- supports migration/versioning.

Suggested storage:

```text
SQLite for ConnectionRecord metadata
```

At minimum persist:

```text
id
connectorId
externalAccountId
displayName
status
scopes
capabilities
credentialReference
createdAt
updatedAt
```

Avoid AsyncStorage for secrets.

---

# 9. CredentialVault is currently in-memory only

Current package:

```text
packages/credential-vault/
```

exports `InMemoryCredentialVault`.

That is useful for tests but not production.

Implement an Android-backed production vault.

Target architecture:

```text
TypeScript CredentialVault
      ↓
Expo native module / Kotlin
      ↓
Android Keystore
      ↓
encrypted credential blob
      ↓
app-private storage
```

Requirements:

- no access token in AsyncStorage;
- no refresh token in React state;
- never log tokens;
- remove credentials on disconnect;
- invalidate connections when credentials are no longer usable;
- support OAuth credentials;
- support static/bot tokens if bot mode remains;
- support TDLib database-key references.

---

# 10. OAuth refresh logic is currently fake

`packages/oauth-core/src/token-provider.ts` currently creates values like:

```text
refreshed-${connectionId}-${Date.now()}
```

Replace fake refresh behavior.

Create provider-specific OAuth token exchange adapters, for example:

```ts
interface OAuthTokenEndpoint {
  refresh(input: {
    refreshToken: string;
    scopes: string[];
  }): Promise<OAuthCredential>;
}
```

Keep common refresh locking in `oauth-core`.

Provider-specific code owns:

- token endpoint;
- client ID;
- PKCE configuration;
- scopes;
- refresh semantics;
- error mapping.

Never bundle a provider client secret into the APK.

If a provider requires a confidential secret, use the project's OAuth broker/backend.

---

# 11. Telegram is currently mock-only

Current Telegram tool names are useful and should be preserved where reasonable:

```text
telegram.user.search_chats
telegram.user.get_recent_messages
telegram.user.send_message

telegram.bot.get_me
telegram.bot.send_message
telegram.bot.edit_message
telegram.bot.delete_message
telegram.bot.send_document
```

However, the current implementations return mock values.

## Priority: Telegram personal account

The app's main Telegram use case is acting on behalf of the authenticated user.

Implement it through TDLib/native Android integration, not by pretending a bot is the user.

Target:

```text
TelegramUserConnector
        ↓
TypeScript TDLib adapter
        ↓
Expo native module
        ↓
Kotlin
        ↓
TDLib
        ↓
Telegram
```

Suggested source tree:

```text
packages/connector-telegram/
  src/
    telegram-user-connector.ts
    telegram-bot-connector.ts
    tdlib/
      types.ts
      bridge.ts

modules/
  telegram-tdlib/
    android/
      src/main/java/.../
        TelegramTdlibModule.kt
        TdlibClient.kt
```

Exact native module location may be adjusted to match the existing Expo-native-module convention in this repository.

---

# 12. Telegram authorization flow

Implement a real state machine.

UI states should support at least:

```text
not_initialized
initializing
wait_phone_number
wait_code
wait_password
ready
logging_out
closed
error
```

Required UX:

```text
Connect Telegram
    ↓
phone number
    ↓
verification code
    ↓
2FA password if required
    ↓
Connected
```

Important:

- do not persist one-time verification codes;
- do not log codes;
- do not log 2FA passwords;
- credentials/session data must stay outside LLM context;
- display the actual connected Telegram identity;
- connection state must persist after application restart.

Expose a connection such as:

```ts
{
  id: 'telegram-user:<telegram-user-id>',
  connectorId: 'telegram-user',
  externalAccountId: '<telegram-user-id>',
  displayName: 'Amin',
  status: 'connected',
  capabilities: [
    'telegram.chats.read',
    'telegram.messages.read',
    'telegram.messages.send'
  ]
}
```

---

# 13. Implement real Telegram tools

## search chats

```text
telegram.user.search_chats
```

Input:

```ts
{
  connectionId: string;
  query: string;
}
```

Return structured data:

```ts
{
  chats: Array<{
    id: string;
    title: string;
    username?: string;
    type: 'private' | 'group' | 'channel' | 'unknown';
  }>;
}
```

Do not make the LLM guess numeric Telegram chat IDs.

## recent messages

```text
telegram.user.get_recent_messages
```

Return:

```ts
{
  chat: {...};
  messages: Array<{
    id: string;
    senderName?: string;
    text: string;
    timestamp: string;
    outgoing: boolean;
  }>;
}
```

Keep the result bounded.

Do not dump an entire Telegram history into the LLM context.

## send message

```text
telegram.user.send_message
```

Input:

```ts
{
  connectionId: string;
  chatId: string;
  text: string;
}
```

Risk:

```text
external_side_effect
```

Must use the existing approval path.

Return the real sent message ID/status.

---

# 14. Split Telegram bot and user connectors cleanly

`TelegramConnector` currently declares:

```ts
readonly id = 'telegram-bot'
```

but returns both `telegram-bot` and `telegram-user` connections.

Refactor into either:

```text
TelegramBotConnector
TelegramUserConnector
```

or redesign the registry so a single connector can explicitly own multiple connector IDs.

Prefer separate connectors because:

- auth modes differ;
- credentials differ;
- capabilities differ;
- lifecycle differs;
- user account and bot account should not share accidental behavior.

---

# 15. Fix multi-account connector registration

`packages/mcp-server/src/register-connector-tools.ts` currently de-duplicates global MCP tool names and skips subsequent connections.

That means:

```text
Google personal
Google work
```

cannot both be addressed correctly.

Refactor tool registration so a tool handler resolves the connection from:

```ts
input.connectionId
```

at execution time.

Do not capture one connection and silently skip the rest.

The registry should be able to resolve:

```ts
registry.getConnection(connectionId)
```

or equivalent.

Validation requirements:

- the connection exists;
- its status is `connected`;
- it belongs to the tool's connector;
- the requested tool is allowed for that connection;
- required scopes/capabilities exist.

One MCP tool name can then serve many accounts.

---

# 16. Make tool schemas more useful to the LLM

The existing tool schema regression tests are good.

Keep the requirement that tool arguments appear as top-level JSON Schema properties.

Improve descriptions.

Bad:

```text
"Send Message"
```

Better:

```text
"Send a Telegram text message from the connected user's personal Telegram account.
Use search_chats first when only a person's name is known.
This action requires explicit user approval."
```

Tool descriptions should tell the model:

- when to use the tool;
- when not to use it;
- what prerequisite lookup to perform;
- whether it causes an external side effect;
- what identifiers it expects.

Do not put secrets or internal implementation details in descriptions.

---

# 17. Add connection/tool discovery to the model context

The agent should know what the user actually has connected.

Before planning, build a compact runtime capability context, for example:

```json
{
  "connections": [
    {
      "id": "telegram-user:123",
      "provider": "telegram-user",
      "displayName": "Amin",
      "capabilities": [
        "telegram.chats.read",
        "telegram.messages.read",
        "telegram.messages.send"
      ]
    }
  ]
}
```

Do not tell the model a connector exists if the user has not authorized it.

When the requested connector is unavailable, the assistant should respond with a UI action such as:

```text
Telegram is not connected.
[Connect Telegram]
```

instead of hallucinating success.

---

# 18. Add an agent state model

A normal chat `isLoading` boolean is not enough.

Introduce states such as:

```ts
type AgentRunState =
  | { type: 'idle' }
  | { type: 'thinking' }
  | { type: 'calling_tool'; toolName: string }
  | { type: 'awaiting_approval'; approval: PendingApproval }
  | { type: 'executing_tool'; toolName: string }
  | { type: 'responding' }
  | { type: 'failed'; error: AgentError };
```

Use it in `app/chat.tsx`.

This lets the UI display:

```text
Searching Telegram…
Waiting for confirmation…
Sending message…
```

instead of only a generic spinner.

---

# 19. Persist conversations with tool events

Current history saves a prompt and assistant reply.

For an agent, store a richer run record.

Suggested shape:

```ts
interface AgentRunHistory {
  id: string;
  threadId: string;
  createdAt: number;

  userMessage: string;
  finalAnswer?: string;

  steps: Array<
    | { type: 'tool_call'; toolName: string; safePreview: unknown }
    | { type: 'tool_result'; toolName: string; success: boolean }
    | { type: 'approval'; toolName: string; approved: boolean }
  >;

  engine: string;
}
```

Never persist raw secrets.

For privacy, avoid persisting full email/message bodies unless the feature explicitly requires it.

---

# 20. Replace MCP debug UI with developer diagnostics

`McpDebugButton` is useful during development but it should not be the only MCP integration.

After the agent loop exists:

- keep MCP diagnostics only in a developer screen;
- remove the MCP button from normal chat UI;
- add a diagnostics screen showing:
  - MCP health;
  - registered tool count;
  - active connections;
  - model capabilities;
  - last sanitized tool error.

Do not display tokens.

---

# 21. Built-in mock calendar should not ship as a real account

`src/mcp/runtime-singleton.ts` still injects `MockCalendarConnector` into the built-in MCP dependencies.

Keep it only for tests/spikes.

Production should use either:

- the Android calendar connector;
- Google Calendar connector;
- a real backend calendar abstraction;

depending on the selected connection.

Do not let the model act against `mock-personal` in production.

---

# 22. Android connector: replace mocks with native implementations

Audit every tool in:

```text
packages/connector-android/
```

and mark it explicitly as:

```text
real
unsupported
development_mock
```

Never return fake successful results in production.

Implement Android-native bridges for the capabilities that belong on-device, prioritizing:

1. contacts search;
2. calendar read/write;
3. share intent;
4. open/deep-link intent;
5. notifications where appropriate;
6. clipboard with clear privacy policy;
7. file picker / document access.

Add Android permissions only for features actually implemented.

Request runtime permissions at the moment they are needed, with a user-visible explanation.

---

# 23. Google connector: replace mock APIs

`packages/connector-google/src/google-connector.ts` currently returns static mock Calendar/Gmail/Drive/People/Tasks data.

Do not attempt to make all Google APIs production-ready in one giant change.

After Telegram vertical slice works, implement in this order:

```text
Google OAuth connection
Google Calendar read
Google Calendar write
Gmail search/read
Gmail draft
Gmail send with approval
Google People search
Google Drive metadata/search
remaining actions
```

All connector HTTP calls need:

- timeout;
- AbortSignal;
- safe error normalization;
- 401 refresh handling;
- 429 handling;
- no authorization headers in logs.

---

# 24. Remaining connectors

The following packages should be treated as capability definitions / mocks until proven otherwise:

```text
connector-microsoft
connector-slack
connector-notion
connector-todoist
connector-github
connector-dropbox
connector-discord
connector-spotify
connector-intents
```

For every connector, add an implementation status exported by the package:

```ts
type ConnectorImplementationStatus =
  | 'mock'
  | 'partial'
  | 'production';
```

The production registry must refuse to register `mock` implementations unless a development flag explicitly enables them.

This prevents the LLM from seeing fake tools and claiming fake success.

---

# 25. Remove or repair dead Worker code

Audit:

```text
src/index.js
```

It imports:

```text
./api/router.js
```

which is missing from the repository.

Decide one of two options:

## If Cloudflare Worker API code is still part of this repository

Restore the missing router and add tests.

## If the backend has moved elsewhere

Remove the dead Worker API routing code and simplify the deployment entry point.

Do not leave a known unresolved import.

Also remove any hard-coded fallback secret such as:

```text
dev-secret-change-in-production
```

from deployable production code.

---

# 26. Align documentation with actual state

Update:

```text
README.md
IMPLEMENT_ALL_CONNECTORS.md
LOCAL_MCP_SETUP.md
AGENTS.md
.env.example
```

after implementation.

README must clearly distinguish:

```text
Implemented and real
Implemented but mock
Not implemented
Requires native development build
Requires backend/OAuth broker
```

Do not describe a mock connector as "connected" or "done".

---

# 27. Add automated tests for the real agent loop

Keep existing:

```bash
npm run typecheck
npm run lint
npm run verify:ai
npm run verify:logic
npm run verify:layout
npm run verify:device
npm run verify:mcp
```

Add:

```bash
npm run verify:agent
npm run verify:connections
```

## `verify:agent`

Test at least:

### Read-only tool

```text
user asks for data
→ planner chooses tool
→ MCP executes without approval
→ tool result returns to planner
→ final answer
```

### Side effect

```text
user asks to send Telegram message
→ planner searches chat
→ send tool returns approval_required
→ execution pauses
→ approve
→ exact payload executes
→ final assistant response
```

### User rejects

```text
approval_required
→ user rejects
→ no connector execution
→ model receives user_denied
```

### Tool error

```text
connector fails
→ error returns to model
→ assistant does not claim success
```

### Infinite loop protection

A broken planner cannot execute more than `MAX_AGENT_STEPS`.

### Cancellation

Stopping a run aborts pending model/tool work where supported.

---

# 28. Add tests for connection truthfulness

Create regression tests proving:

- fresh install exposes no external account tools;
- tapping a UI button does not create a fake connection;
- only a successful auth flow creates `status: connected`;
- disconnect removes/revokes credentials;
- MCP tools disappear after disconnect;
- expired connection does not expose writable tools;
- two Google accounts can coexist;
- two accounts using the same tool name are selected by `connectionId`;
- app restart restores persisted connections.

---

# 29. Add Telegram integration tests

Separate native/provider integration tests from normal unit tests.

At minimum create a mock TDLib adapter implementing the same interface as the real bridge.

Test:

```text
searchChats("Данияр")
getRecentMessages(chatId)
sendMessage(chatId, text)
```

Then test the full agent path against the fake adapter.

Do not require a real Telegram account for CI.

Real-device/manual test checklist:

```text
[ ] install dev build
[ ] connect Telegram
[ ] enter phone
[ ] enter code
[ ] handle 2FA if enabled
[ ] restart app
[ ] connection remains available
[ ] ask agent to find a chat
[ ] ask agent to read recent messages
[ ] ask agent to send a message
[ ] approval sheet appears
[ ] cancel sends nothing
[ ] approve sends exactly once
[ ] recipient/message match preview
[ ] disconnect Telegram
[ ] Telegram tools disappear
```

---

# 30. Security requirements

These are non-negotiable.

The LLM must never receive:

```text
OAuth access token
OAuth refresh token
bot token
Telegram verification code
Telegram 2FA password
TDLib database encryption key
client secret
Android Keystore material
```

Logs must redact:

```text
Authorization
Cookie
Set-Cookie
tokens
verification codes
passwords
```

Do not log full private message histories in production.

External side effects must be human-approved unless a future explicit user preference/policy safely changes that behavior.

Do not execute a side-effectful tool just because the LLM says the user approved it.

---

# 31. Error model

Create normalized agent/connector errors.

Suggested:

```ts
type AgentErrorCode =
  | 'AUTH_REQUIRED'
  | 'CONNECTION_NOT_FOUND'
  | 'CONNECTION_EXPIRED'
  | 'PERMISSION_REQUIRED'
  | 'USER_DENIED'
  | 'TOOL_VALIDATION_ERROR'
  | 'TOOL_EXECUTION_ERROR'
  | 'MODEL_ERROR'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'CANCELLED'
  | 'MAX_STEPS_EXCEEDED';
```

The UI should display actionable messages.

Example:

```text
Telegram authorization expired.
[Reconnect]
```

not:

```text
ToolExecutionError
```

---

# 32. Network/offline behavior

The application is designed around on-device operation, so make failure modes explicit.

Examples:

```text
Local model + Android connector
→ can work offline

Local model + Telegram
→ model is local but Telegram still requires network

Remote model
→ requires network even for local tools
```

Expose this distinction in the UI when useful.

Never report "offline" simply because inference is on-device if the requested connector requires the internet.

---

# 33. Production registry design

Refactor the registry factory so dependencies are explicit.

Target shape:

```ts
createConnectorRegistry({
  connectionStore,
  credentialVault,
  tokenProviderFactory,
  httpClient,
  nativeBridges,
  environment,
});
```

Avoid connector constructors that secretly create in-memory stores.

This makes connectors testable and prevents production from accidentally using mocks.

---

# 34. Definition of done for Phase 1

Do not claim Phase 1 is finished until all are true:

```text
[ ] Chat uses the agent orchestration layer.
[ ] Agent receives MCP tool definitions.
[ ] Agent can emit validated tool calls.
[ ] MCP tool results return to the LLM.
[ ] Tool calls/results remain in conversation state.
[ ] Approval UI is integrated into chat.
[ ] Cancelled approval executes nothing.
[ ] Approved payload executes exactly once.
[ ] MAX_AGENT_STEPS exists.
[ ] Cancellation works.
[ ] Production runtime does not auto-connect mock accounts.
[ ] UI connection state comes from a shared persistent source.
[ ] MCP connection state uses the same source.
[ ] Existing verification scripts still pass.
[ ] New verify:agent tests pass.
```

---

# 35. Definition of done for Telegram Phase

```text
[ ] Telegram personal-account connector is not mock.
[ ] TDLib/native bridge initializes on Android dev build.
[ ] Phone/code/2FA auth flow works.
[ ] Telegram session survives app restart.
[ ] Telegram identity is shown in Connectors UI.
[ ] search_chats returns real chats.
[ ] get_recent_messages returns real bounded history.
[ ] send_message sends a real message.
[ ] send_message always enters approval flow.
[ ] The LLM can resolve a person by name before sending.
[ ] Ambiguous chat matches are presented to the user instead of guessed.
[ ] Disconnect removes the connection from MCP.
[ ] No Telegram secrets enter model context or logs.
```

---

# 36. Recommended implementation order

Follow this order. Do not start by implementing every provider.

## Phase A — agent orchestration

```text
AgentModel abstraction
tool mapper
MCP execution loop
tool-result feedback
max steps
cancellation
agent state
```

## Phase B — approvals

```text
approval UI
approve/reject flow
safe preview
tool retry with approvalId
```

## Phase C — real connection model

```text
persistent ConnectionStore
production registry
remove mock auto-connected state
Account/Onboarding connection queries
```

## Phase D — Telegram vertical slice

```text
TDLib bridge
Telegram auth UI
TelegramUserConnector
search chats
recent messages
send message
```

## Phase E — secure credentials

```text
native CredentialVault
real token/session persistence
```

Telegram session integration and vault work may overlap where TDLib requires it.

## Phase F — Google

```text
OAuth
Calendar
Gmail
People
Drive
Tasks
```

## Phase G — remaining connectors

Implement provider by provider, never by returning fake success.

---

# 37. Coding rules for the agent

1. Read `AGENTS.md` before changing Expo code.
2. Preserve Expo SDK 57 compatibility.
3. Do not blindly upgrade dependencies.
4. Do not create packages inside `node_modules`.
5. Reuse existing workspace packages.
6. Do not replace MCP with direct connector calls from the UI.
7. Do not let LLM code access credentials.
8. Do not remove approval safeguards.
9. Do not disable tests to make CI green.
10. Do not mark mocks as production implementations.
11. Prefer small commits grouped by subsystem.
12. After each phase run the relevant verification scripts.
13. Add tests before refactoring security-sensitive approval logic.
14. Avoid large unrelated visual redesigns.
15. Keep the existing design system and Expo Router structure unless required.

---

# 38. Required verification after changes

Run:

```bash
npm run typecheck
npm run lint
npm run verify:ai
npm run verify:logic
npm run verify:layout
npm run verify:device
npm run verify:mcp
npm run verify:agent
npm run verify:connections
```

Also verify native Android compilation:

```bash
npx expo run:android
```

For native Telegram/TDLib changes, JavaScript-only tests are not enough.

The Android project must compile and launch.

---

# 39. First task to implement now

Start with **Agent Orchestration**, not Telegram native code.

Implement the following first:

```text
src/agent/
```

and make this work with a deterministic fake planner + existing MCP mocks:

```text
User:
"Напиши Данияру привет"

Planner:
telegram.user.search_chats

MCP result:
Daniyar chat

Planner:
telegram.user.send_message

MCP:
approval_required

UI:
approval sheet

User:
Approve

MCP:
success

Planner:
final answer
```

Only when this full loop passes automatically should the mock Telegram adapter be replaced with TDLib.

This ordering isolates bugs:

```text
LLM/planner bug
MCP bug
approval bug
UI bug
Telegram native/auth bug
```

instead of debugging all five simultaneously.

---

# 40. Final expected architecture

```text
┌──────────────────────── Android app ────────────────────────┐
│                                                             │
│  Chat UI                                                    │
│     │                                                       │
│     ▼                                                       │
│  AgentProvider / AgentRuntime                               │
│     │                                                       │
│     ├────────► AgentModel / LLM                             │
│     │             │                                         │
│     │             └── validated tool call                   │
│     │                                                       │
│     ▼                                                       │
│  MCP Client                                                 │
│     │                                                       │
│     ▼                                                       │
│  MCP Server                                                 │
│     │                                                       │
│     ▼                                                       │
│  PolicyEngine                                               │
│     │                                                       │
│     ▼                                                       │
│  ApprovalService ◄──── ApprovalSheet                        │
│     │                                                       │
│     ▼                                                       │
│  ConnectorRegistry                                          │
│     │                                                       │
│     ├──────── TelegramUserConnector ── TDLib ── Telegram     │
│     ├──────── GoogleConnector ───────── APIs                 │
│     ├──────── AndroidConnector ──────── Native APIs          │
│     └──────── ...                                            │
│                                                             │
│  ConnectionStore + CredentialVault                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

The key architectural rule is:

> The LLM plans actions. MCP executes tools. Connectors own provider access. The UI owns human approval. Credentials stay outside the model.

