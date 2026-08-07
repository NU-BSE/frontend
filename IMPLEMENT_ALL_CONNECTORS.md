# IMPLEMENT_ALL_CONNECTORS.md

> Implementation specification for a local Android MCP agent.
>
> This document assumes `LOCAL_MCP_SETUP.md` has already been implemented:
>
> - local `McpServer`;
> - local `Client`;
> - `InMemoryTransport`;
> - workspace packages;
> - `system.health`;
> - agent calls tools through MCP rather than calling provider APIs directly.

---

# 0. Goal

Implement a reusable connector framework for a mobile AI agent where:

```text
User
  ↓
Chat UI
  ↓
Planner / VLM / Agent
  ↓
Local MCP Client
  ↓
InMemoryTransport
  ↓
Local MCP Server
  ↓
PolicyEngine
  ↓
ApprovalService
  ↓
ConnectorRegistry
  ↓
Provider Connector
  ↓
CredentialVault
  ↓
External API / Android Native API
```

The model MUST NOT receive OAuth credentials.

The model receives only:

```json
{
  "connectionId": "google-personal",
  "provider": "google",
  "capabilities": [
    "calendar.read",
    "calendar.write"
  ]
}
```

Never expose:

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "clientSecret": "...",
  "botToken": "..."
}
```

---

# 1. Connectors to implement

This specification implements the connector framework for:

## Android / local device

- Android contacts
- Android calendar
- Android files
- Android share sheet
- Android intents / deep links
- Android notifications
- Android reminders
- Android location
- Android clipboard
- Android media controls
- Installed applications

## Google

- Google Calendar
- Gmail
- Google Drive
- Google People / Contacts
- Google Tasks

## Telegram

- Telegram Bot API
- Telegram personal account through TDLib

## Microsoft

- Outlook Mail
- Outlook Calendar
- Microsoft Contacts
- OneDrive
- Microsoft To Do
- Teams where the Graph permissions/API permit the required operation

## Productivity

- Slack
- Notion
- Todoist

## Developer / storage

- GitHub
- Dropbox

## Communication / media

- Discord
- Spotify

## App fallback

- generic Android Intent connector
- WhatsApp share/deep-link connector
- VLM/UI automation fallback for research/internal builds only

---

# 2. Authorization strategy

Not every provider can be authorized in exactly the same way.

Use these modes:

```typescript
export type ConnectorAuthMode =
  | "none"
  | "android_permission"
  | "pkce"
  | "device_flow"
  | "oauth_broker"
  | "bot_token"
  | "tdlib"
  | "native_sdk";
```

Recommended mode:

| Connector | Recommended auth |
|---|---|
| Android | Android runtime/system permissions |
| Google | native Google authorization / OAuth with PKCE-compatible mobile flow |
| Telegram Bot | bot token stored in vault |
| Telegram TDLib | TDLib authorization flow |
| Microsoft | Authorization Code + PKCE |
| Slack | OAuth broker |
| Notion | OAuth broker |
| Todoist | OAuth broker unless using its public-client/dynamic-registration flow |
| GitHub | Device Flow or OAuth/GitHub App |
| Dropbox | Authorization Code + PKCE |
| Discord | OAuth broker for user authorization; bot token for bot identity |
| Spotify | Authorization Code + PKCE |

Important:

```text
APK == public client
```

Anything included in the APK can eventually be extracted.

Therefore never put a provider `client_secret` in:

- TypeScript source;
- Kotlin source;
- `strings.xml`;
- Gradle properties bundled into APK;
- Expo constants;
- `.env` that gets bundled;
- MCP tool definitions.

If a provider requires a client secret during authorization-code exchange, use a small OAuth broker.

The broker is NOT the MCP server.

The local MCP server and tool execution can remain local.

---

# 3. Target monorepo

```text
mobile-agent/
├── apps/
│   └── mobile/
│       ├── android/
│       └── src/
│           ├── connections/
│           ├── approvals/
│           └── mcp/
│
├── packages/
│   ├── connector-core/
│   ├── connector-android/
│   ├── connector-google/
│   ├── connector-telegram/
│   ├── connector-microsoft/
│   ├── connector-slack/
│   ├── connector-notion/
│   ├── connector-todoist/
│   ├── connector-github/
│   ├── connector-dropbox/
│   ├── connector-discord/
│   ├── connector-spotify/
│   ├── connector-intents/
│   ├── credential-vault/
│   ├── oauth-core/
│   ├── approval-core/
│   ├── policy-core/
│   ├── mcp-server/
│   └── mcp-client/
│
└── package.json
```

Do not create custom packages inside `node_modules`.

---

# 4. connector-core

Create:

```text
packages/connector-core/src/types.ts
```

```typescript
import type * as z from "zod/v4";

export type ConnectorId =
  | "android"
  | "google"
  | "telegram-bot"
  | "telegram-user"
  | "microsoft"
  | "slack"
  | "notion"
  | "todoist"
  | "github"
  | "dropbox"
  | "discord"
  | "spotify"
  | "intent";

export type ConnectionStatus =
  | "connected"
  | "disconnected"
  | "expired"
  | "reconnect_required"
  | "permission_required"
  | "error";

export type ToolRisk =
  | "read"
  | "write"
  | "external_side_effect"
  | "destructive";

export interface ConnectionRecord {
  id: string;
  connectorId: ConnectorId;

  externalAccountId?: string;
  displayName: string;

  status: ConnectionStatus;

  scopes: string[];
  capabilities: string[];

  credentialReference?: string;

  createdAt: number;
  updatedAt: number;
}

export interface ToolExecutionContext {
  taskId: string;
  agentId: string;

  connection: ConnectionRecord;

  approvalId?: string;
  idempotencyKey: string;

  signal?: AbortSignal;
}

export interface ConnectorTool<
  TInput = unknown,
  TOutput = unknown,
> {
  name: string;
  title: string;
  description: string;

  inputSchema: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;

  risk: ToolRisk;

  capabilities: string[];
  requiredScopes: string[];

  execute(
    input: TInput,
    context: ToolExecutionContext,
  ): Promise<TOutput>;
}

export interface Connector {
  readonly id: ConnectorId;
  readonly displayName: string;

  listConnections():
    Promise<ConnectionRecord[]>;

  getConnection(
    connectionId: string,
  ): Promise<ConnectionRecord | null>;

  getTools(
    connection: ConnectionRecord,
  ): Promise<
    ConnectorTool<any, any>[]
  >;

  disconnect(
    connectionId: string,
  ): Promise<void>;
}
```

Create:

```text
packages/connector-core/src/errors.ts
```

```typescript
export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_CONNECTED"
      | "AUTH_REQUIRED"
      | "PERMISSION_REQUIRED"
      | "RATE_LIMITED"
      | "NOT_FOUND"
      | "VALIDATION_FAILED"
      | "PROVIDER_ERROR"
      | "UNSUPPORTED"
      | "CANCELLED",
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
```

Create:

```text
packages/connector-core/src/index.ts
```

```typescript
export * from "./types.js";
export * from "./errors.js";
```

---

# 5. ConnectionStore

Create a persistent store abstraction.

```typescript
import type {
  ConnectionRecord,
  ConnectorId,
} from "@mobile-agent/connector-core";

export interface ConnectionStore {
  get(
    id: string,
  ): Promise<ConnectionRecord | null>;

  list(): Promise<
    ConnectionRecord[]
  >;

  listByConnector(
    connectorId: ConnectorId,
  ): Promise<
    ConnectionRecord[]
  >;

  save(
    connection: ConnectionRecord,
  ): Promise<void>;

  remove(
    id: string,
  ): Promise<void>;
}
```

Recommended implementation:

```text
SQLite:
connections
```

Suggested schema:

```sql
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  external_account_id TEXT,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  credential_reference TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

---

# 6. CredentialVault

Create:

```text
packages/credential-vault/src/types.ts
```

```typescript
export interface OAuthCredential {
  kind: "oauth";

  accessToken: string;
  refreshToken?: string;

  accessTokenExpiresAt?: number;

  tokenType?: string;
  scopes: string[];
}

export interface StaticTokenCredential {
  kind: "static_token";
  token: string;
}

export interface TdlibCredential {
  kind: "tdlib";
  databaseKeyReference: string;
}

export type StoredCredential =
  | OAuthCredential
  | StaticTokenCredential
  | TdlibCredential;

export interface CredentialVault {
  save(
    reference: string,
    credential: StoredCredential,
  ): Promise<void>;

  get(
    reference: string,
  ): Promise<StoredCredential | null>;

  remove(
    reference: string,
  ): Promise<void>;
}
```

Production implementation:

```text
TypeScript
   ↓
Native CredentialVault module
   ↓
Android Keystore key
   ↓
AES-GCM encrypted credential blob
   ↓
app-private storage / encrypted DB
```

Do not store large token JSON directly as React state.

Never log credential values.

---

# 7. OAuth core

Create a reusable PKCE helper.

```text
packages/oauth-core/src/pkce.ts
```

```typescript
export interface PkcePair {
  verifier: string;
  challenge: string;
}

function base64Url(
  bytes: Uint8Array,
): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function createPkcePair():
  Promise<PkcePair> {
  const bytes =
    crypto.getRandomValues(
      new Uint8Array(64),
    );

  const verifier =
    base64Url(bytes);

  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder()
        .encode(verifier),
    );

  return {
    verifier,
    challenge:
      base64Url(
        new Uint8Array(digest),
      ),
  };
}
```

If `crypto.subtle` is unavailable in the target React Native runtime, implement this in the Android native bridge rather than adding insecure random-number fallbacks.

Create:

```typescript
export interface OAuthSession {
  id: string;
  provider: string;

  state: string;

  codeVerifier?: string;

  requestedScopes: string[];

  redirectUri: string;

  createdAt: number;
  expiresAt: number;
}

export interface OAuthSessionStore {
  save(
    session: OAuthSession,
  ): Promise<void>;

  consumeByState(
    state: string,
  ): Promise<OAuthSession | null>;
}
```

`state` must be random and one-time.

---

# 8. TokenProvider

All OAuth connectors should use a token provider rather than reading the vault directly inside every tool.

```typescript
export interface AccessTokenProvider {
  getValidAccessToken(
    connectionId: string,
  ): Promise<string>;

  invalidateAccessToken?(
    connectionId: string,
  ): Promise<void>;
}
```

Responsibilities:

```text
connectionId
  ↓
ConnectionStore
  ↓
credentialReference
  ↓
CredentialVault
  ↓
is access token still valid?
     ├─ yes → return
     └─ no → refresh
              ↓
          save rotated tokens
              ↓
          return new access token
```

Add a per-connection refresh lock to avoid several parallel refresh requests.

---

# 9. HTTP client

Create:

```typescript
export interface ConnectorHttpRequest {
  method?:
    | "GET"
    | "POST"
    | "PUT"
    | "PATCH"
    | "DELETE";

  url: string;

  headers?: Record<
    string,
    string
  >;

  body?: string;

  signal?: AbortSignal;
}

export interface ConnectorHttpResponse {
  status: number;
  headers:
    Record<string, string>;
  text: string;
}

export interface ConnectorHttpClient {
  request(
    request:
      ConnectorHttpRequest,
  ): Promise<
    ConnectorHttpResponse
  >;
}
```

The HTTP wrapper should:

- apply timeouts;
- support AbortSignal;
- redact Authorization headers from logs;
- normalize 401/403/404/409/429/5xx;
- support retry-after;
- never automatically retry non-idempotent writes unless an idempotency strategy exists.

---

# 10. Approval system

Tool risk rules:

```typescript
export const DEFAULT_APPROVAL_POLICY = {
  read: "never",
  write: "configurable",
  external_side_effect: "always",
  destructive: "always",
} as const;
```

Examples:

```text
calendar.list_events        → read
calendar.create_event       → write
gmail.create_draft          → write
gmail.send_draft            → external_side_effect
telegram.send_message       → external_side_effect
drive.share                 → external_side_effect
calendar.delete_event       → destructive
todoist.delete_task         → destructive
```

Approval must be bound to the exact action payload.

```typescript
export interface ApprovalRecord {
  id: string;

  taskId: string;
  toolName: string;
  connectionId: string;

  argumentsHash: string;

  createdAt: number;
  expiresAt: number;

  approvedAt?: number;
  consumedAt?: number;
}
```

Do not accept:

```text
"yes, approve Gmail"
```

Accept only approval for a specific:

```text
toolName
connectionId
recipient
subject
body hash
attachment list
```

---

# 11. ConnectorRegistry

```typescript
import type {
  Connector,
  ConnectorId,
  ConnectionRecord,
  ConnectorTool,
} from "@mobile-agent/connector-core";

export class ConnectorRegistry {
  private readonly connectors =
    new Map<
      ConnectorId,
      Connector
    >();

  register(
    connector: Connector,
  ): void {
    this.connectors.set(
      connector.id,
      connector,
    );
  }

  get(
    id: ConnectorId,
  ): Connector {
    const connector =
      this.connectors.get(id);

    if (!connector) {
      throw new Error(
        `Connector ${id} is not registered`,
      );
    }

    return connector;
  }

  async listActiveTools():
    Promise<
      Array<{
        connection:
          ConnectionRecord;
        tool:
          ConnectorTool<any, any>;
      }>
    > {
    const result: Array<{
      connection:
        ConnectionRecord;
      tool:
        ConnectorTool<any, any>;
    }> = [];

    for (
      const connector
      of this.connectors.values()
    ) {
      const connections =
        await connector
          .listConnections();

      for (
        const connection
        of connections
      ) {
        if (
          connection.status !==
          "connected"
        ) {
          continue;
        }

        const tools =
          await connector
            .getTools(
              connection,
            );

        for (const tool of tools) {
          result.push({
            connection,
            tool,
          });
        }
      }
    }

    return result;
  }
}
```

---

# 12. Register connector tools in MCP

Do not hard-code every provider directly in `create-server.ts`.

Create a dynamic registration layer.

```typescript
import {
  McpServer,
} from "@modelcontextprotocol/server";

import type {
  ConnectorRegistry,
} from "./connector-registry";

export async function registerConnectorTools(
  server: McpServer,
  registry: ConnectorRegistry,
  policyEngine: PolicyEngine,
  approvalService: ApprovalService,
): Promise<void> {
  const items =
    await registry
      .listActiveTools();

  for (const {
    connection,
    tool,
  } of items) {
    /*
     * Include connection ID in tool name only if
     * the planner has several accounts and the MCP
     * implementation cannot safely resolve it from context.
     *
     * Preferred public tool name:
     * google.calendar.list_events
     *
     * Preferred input:
     * { connectionId: "google-work", ... }
     */

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description:
          tool.description,
        inputSchema:
          tool.inputSchema,
        outputSchema:
          tool.outputSchema,
        annotations: {
          readOnlyHint:
            tool.risk === "read",

          destructiveHint:
            tool.risk ===
            "destructive",

          idempotentHint:
            tool.risk ===
            "read",

          openWorldHint: true,
        },
      },
      async (input) => {
        const policy =
          await policyEngine
            .authorize({
              connection,
              tool,
              input,
            });

        if (!policy.allowed) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  policy.reason,
              },
            ],
          };
        }

        if (
          policy
            .requiresApproval
        ) {
          const approval =
            await approvalService
              .create({
                connection,
                tool,
                input,
              });

          return {
            content: [
              {
                type: "text",
                text:
                  "User confirmation required",
              },
            ],
            structuredContent: {
              status:
                "approval_required",
              approvalId:
                approval.id,
              preview:
                approval.preview,
            },
          };
        }

        const output =
          await tool.execute(
            input,
            {
              taskId:
                policy.taskId,
              agentId:
                policy.agentId,
              connection,
              idempotencyKey:
                policy
                  .idempotencyKey,
            },
          );

        return {
          content: [
            {
              type: "text",
              text:
                JSON.stringify(
                  output,
                ),
            },
          ],
          structuredContent: {
            status: "success",
            data: output,
          },
        };
      },
    );
  }
}
```

---

# 13. ANDROID CONNECTOR

Create:

```text
packages/connector-android/
```

Android capabilities should be implemented by Kotlin native APIs and exposed through a TypeScript bridge.

## 13.1 Android native bridge contract

```typescript
export interface AndroidContact {
  id: string;
  displayName: string;

  phones: string[];
  emails: string[];
}

export interface AndroidCalendarEvent {
  id: string;

  calendarId: string;

  title: string;

  startMs: number;
  endMs: number;

  location?: string;
}

export interface AndroidNotification {
  key: string;
  packageName: string;

  title?: string;
  text?: string;

  postedAt: number;
}

export interface AndroidNativeBridge {
  requestPermission(
    permission: string,
  ): Promise<
    "granted" |
    "denied" |
    "blocked"
  >;

  searchContacts(
    query: string,
  ): Promise<
    AndroidContact[]
  >;

  listCalendarEvents(
    startMs: number,
    endMs: number,
  ): Promise<
    AndroidCalendarEvent[]
  >;

  openCalendarInsertUi(
    input: {
      title: string;
      startMs: number;
      endMs: number;
      location?: string;
    },
  ): Promise<void>;

  openUri(
    uri: string,
  ): Promise<void>;

  shareText(
    input: {
      text: string;
      packageName?: string;
    },
  ): Promise<void>;

  shareFile(
    input: {
      uri: string;
      mimeType: string;
      packageName?: string;
    },
  ): Promise<void>;

  pickDocument(
    mimeTypes: string[],
  ): Promise<
    | {
        uri: string;
        name?: string;
        mimeType?: string;
      }
    | null
  >;

  createDocument(
    input: {
      suggestedName: string;
      mimeType: string;
    },
  ): Promise<
    string | null
  >;

  listNotifications():
    Promise<
      AndroidNotification[]
    >;

  dismissNotification(
    key: string,
  ): Promise<void>;

  getCurrentLocation():
    Promise<{
      latitude: number;
      longitude: number;
      accuracyMeters?: number;
    }>;

  getClipboardText():
    Promise<string | null>;

  setClipboardText(
    value: string,
  ): Promise<void>;

  listInstalledApps():
    Promise<
      Array<{
        packageName: string;
        label: string;
      }>
    >;

  openApp(
    packageName: string,
  ): Promise<void>;

  mediaPlay():
    Promise<void>;

  mediaPause():
    Promise<void>;
}
```

## 13.2 MCP tools

Implement:

```text
android.contacts.search
android.calendar.list_events
android.calendar.prepare_event
android.files.pick
android.files.create
android.notifications.list
android.notifications.dismiss
android.location.current
android.clipboard.read
android.clipboard.write
android.apps.list
android.apps.open
android.intents.open_uri
android.share.text
android.share.file
android.media.play
android.media.pause
```

Risk levels:

```text
contacts.search             read
calendar.list_events        read
calendar.prepare_event      write
files.pick                  write/user-mediated
files.create                write/user-mediated
notifications.list          read
notifications.dismiss       write
location.current            read + OS permission
clipboard.read              read
clipboard.write             write
apps.list                   read
apps.open                   write
share.text                  external_side_effect
share.file                  external_side_effect
media.play                  write
media.pause                 write
```

Prefer Android's system UI for file selection and calendar insertion where useful.

Use Storage Access Framework for user-selected documents rather than requesting broad storage access.

Notifications require the user to explicitly enable notification-listener access.

---

# 14. GOOGLE CONNECTOR

Create:

```text
packages/connector-google/
├── src/
│   ├── auth/
│   ├── calendar/
│   ├── gmail/
│   ├── drive/
│   ├── people/
│   ├── tasks/
│   ├── google-token-provider.ts
│   ├── google-connector.ts
│   └── index.ts
```

Use one Google account connection:

```typescript
interface GoogleConnection
  extends ConnectionRecord {
  connectorId: "google";

  capabilities: Array<
    | "google.calendar.read"
    | "google.calendar.write"
    | "google.gmail.read"
    | "google.gmail.compose"
    | "google.gmail.modify"
    | "google.drive.read"
    | "google.drive.file"
    | "google.contacts.read"
    | "google.contacts.write"
    | "google.tasks.read"
    | "google.tasks.write"
  >;
}
```

Request capabilities incrementally.

Do NOT request every scope at onboarding.

---

# 15. Google Calendar

Recommended tools:

```text
google.calendar.list_calendars
google.calendar.list_events
google.calendar.get_event
google.calendar.check_availability
google.calendar.create_event
google.calendar.update_event
google.calendar.delete_event
```

Example schemas:

```typescript
import * as z from "zod/v4";

export const listEventsInput =
  z.object({
    connectionId:
      z.string().min(1),

    calendarId:
      z.string()
        .default("primary"),

    start:
      z.string()
        .datetime({
          offset: true,
        }),

    end:
      z.string()
        .datetime({
          offset: true,
        }),

    maxResults:
      z.number()
        .int()
        .min(1)
        .max(100)
        .default(20),
  });
```

Implementation:

```typescript
export class GoogleCalendarApi {
  constructor(
    private readonly tokens:
      AccessTokenProvider,
    private readonly http:
      ConnectorHttpClient,
  ) {}

  async listEvents(
    input:
      z.infer<
        typeof listEventsInput
      >,
  ) {
    const token =
      await this.tokens
        .getValidAccessToken(
          input.connectionId,
        );

    const url =
      new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${
          encodeURIComponent(
            input.calendarId,
          )
        }/events`,
      );

    url.searchParams.set(
      "timeMin",
      input.start,
    );

    url.searchParams.set(
      "timeMax",
      input.end,
    );

    url.searchParams.set(
      "singleEvents",
      "true",
    );

    url.searchParams.set(
      "orderBy",
      "startTime",
    );

    url.searchParams.set(
      "maxResults",
      String(
        input.maxResults,
      ),
    );

    const response =
      await this.http.request({
        url:
          url.toString(),

        headers: {
          Authorization:
            `Bearer ${token}`,
        },
      });

    if (
      response.status < 200 ||
      response.status >= 300
    ) {
      throw mapProviderError(
        "google-calendar",
        response,
      );
    }

    return JSON.parse(
      response.text,
    );
  }
}
```

`create_event`, `update_event`, and `delete_event` must use approvals according to policy.

---

# 16. Gmail

Add Gmail only after Calendar is stable.

Tools:

```text
google.gmail.search
google.gmail.get_message
google.gmail.get_thread
google.gmail.create_draft
google.gmail.update_draft
google.gmail.list_drafts
google.gmail.send_draft
google.gmail.archive
google.gmail.mark_read
```

Risk:

```text
search             read
get_message        read
get_thread         read
create_draft       write
update_draft       write
list_drafts        read
send_draft         external_side_effect
archive            write
mark_read          write
```

Never give the model unrestricted raw email export unless required by the active task.

Prefer metadata/snippets in search results.

Fetch full content only when necessary.

Suggested normalized model:

```typescript
export interface NormalizedEmail {
  id: string;
  threadId: string;

  from?: string;
  to: string[];

  subject?: string;

  snippet?: string;

  receivedAt?: string;

  bodyText?: string;
}
```

Draft creation should be separated from sending:

```text
prepare content
  ↓
create draft
  ↓
show preview
  ↓
approval
  ↓
send existing draft
```

This makes confirmation safer.

---

# 17. Google Drive

Tools:

```text
google.drive.search
google.drive.get_metadata
google.drive.download
google.drive.upload
google.drive.create_folder
google.drive.share
google.drive.delete
```

Prefer app-limited / narrow file access where possible.

Avoid full Drive access unless a feature requires it.

Risk:

```text
search             read
get_metadata       read
download           read
upload             write
create_folder      write
share              external_side_effect
delete             destructive
```

Large files should not be converted to base64 and inserted into model context.

Return:

```typescript
interface LocalFileReference {
  fileId: string;
  localUri?: string;
  providerUrl?: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
}
```

---

# 18. Google People / Contacts

Tools:

```text
google.people.search
google.people.get
google.people.create
google.people.update
google.people.delete
```

Normalize:

```typescript
export interface PersonRecord {
  id: string;
  displayName: string;
  emails: string[];
  phones: string[];
  organizations?: string[];
}
```

Use contacts to resolve names before messaging:

```text
"send Daniyar the file"
        ↓
IdentityResolver
        ↓
contacts search
        ↓
candidate identities
        ↓
if ambiguous → ask user
```

Never choose between two similarly named contacts without sufficient confidence.

---

# 19. Google Tasks

Tools:

```text
google.tasks.list_tasklists
google.tasks.list
google.tasks.create
google.tasks.update
google.tasks.complete
google.tasks.delete
```

Risk:

```text
list              read
create            write
update            write
complete          write
delete            destructive
```

---

# 20. GoogleConnector class

```typescript
export class GoogleConnector
  implements Connector
{
  readonly id = "google"
    as const;

  readonly displayName =
    "Google";

  constructor(
    private readonly connections:
      ConnectionStore,

    private readonly calendar:
      GoogleCalendarTools,

    private readonly gmail:
      GmailTools,

    private readonly drive:
      GoogleDriveTools,

    private readonly people:
      GooglePeopleTools,

    private readonly tasks:
      GoogleTasksTools,
  ) {}

  async listConnections() {
    return this.connections
      .listByConnector(
        "google",
      );
  }

  async getConnection(
    id: string,
  ) {
    const item =
      await this.connections
        .get(id);

    return (
      item?.connectorId ===
      "google"
    )
      ? item
      : null;
  }

  async getTools(
    connection:
      ConnectionRecord,
  ) {
    const tools = [];

    if (
      connection.capabilities
        .includes(
          "google.calendar.read",
        )
    ) {
      tools.push(
        ...this.calendar
          .readTools(),
      );
    }

    if (
      connection.capabilities
        .includes(
          "google.calendar.write",
        )
    ) {
      tools.push(
        ...this.calendar
          .writeTools(),
      );
    }

    if (
      connection.capabilities
        .includes(
          "google.gmail.read",
        )
    ) {
      tools.push(
        ...this.gmail
          .readTools(),
      );
    }

    if (
      connection.capabilities
        .includes(
          "google.gmail.compose",
        )
    ) {
      tools.push(
        ...this.gmail
          .composeTools(),
      );
    }

    /*
     * Repeat for Drive,
     * People and Tasks.
     */

    return tools;
  }

  async disconnect(
    connectionId: string,
  ) {
    /*
     * Revoke provider token
     * where appropriate,
     * then delete vault entry
     * and ConnectionRecord.
     */
  }
}
```

---

# 21. TELEGRAM BOT CONNECTOR

Use this for the agent's bot identity.

Create:

```text
packages/connector-telegram/src/bot/
```

Tools:

```text
telegram.bot.get_me
telegram.bot.send_message
telegram.bot.edit_message
telegram.bot.delete_message
telegram.bot.send_document
```

`send_message`, `edit_message`, `delete_message`, `send_document` produce external effects.

Example:

```typescript
export class TelegramBotApi {
  constructor(
    private readonly vault:
      CredentialVault,
    private readonly http:
      ConnectorHttpClient,
  ) {}

  private async token(
    connection:
      ConnectionRecord,
  ) {
    if (
      !connection
        .credentialReference
    ) {
      throw new ConnectorError(
        "Telegram bot is not connected",
        "NOT_CONNECTED",
      );
    }

    const credential =
      await this.vault.get(
        connection
          .credentialReference,
      );

    if (
      credential?.kind !==
      "static_token"
    ) {
      throw new ConnectorError(
        "Invalid Telegram credential",
        "AUTH_REQUIRED",
      );
    }

    return credential.token;
  }

  async sendMessage(
    connection:
      ConnectionRecord,
    chatId:
      string | number,
    text: string,
  ) {
    const token =
      await this.token(
        connection,
      );

    const response =
      await this.http.request({
        method: "POST",

        url:
          `https://api.telegram.org/bot${token}/sendMessage`,

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            chat_id: chatId,
            text,
          }),
      });

    if (
      response.status < 200 ||
      response.status >= 300
    ) {
      throw mapProviderError(
        "telegram",
        response,
      );
    }

    return JSON.parse(
      response.text,
    );
  }
}
```

Never log the URL above because it contains the bot token.

Redact it before logging.

For receiving messages, prefer an app/backend event source. A continuously polling local Android process is vulnerable to lifecycle restrictions.

---

# 22. TELEGRAM USER / TDLib CONNECTOR

Do not implement a personal Telegram account by pretending to be a bot.

Use TDLib through a native Android module.

Architecture:

```text
TypeScript TelegramUserConnector
  ↓
Kotlin TdlibBridge
  ↓
JNI / TDLib
  ↓
Telegram
```

Bridge contract:

```typescript
export interface TdlibBridge {
  initialize(
    connectionId: string,
  ): Promise<void>;

  getAuthorizationState(
    connectionId: string,
  ): Promise<string>;

  setPhoneNumber(
    connectionId: string,
    phoneNumber: string,
  ): Promise<void>;

  submitAuthCode(
    connectionId: string,
    code: string,
  ): Promise<void>;

  submitPassword(
    connectionId: string,
    password: string,
  ): Promise<void>;

  searchChats(
    connectionId: string,
    query: string,
    limit: number,
  ): Promise<
    TdlibChat[]
  >;

  getRecentMessages(
    connectionId: string,
    chatId: number,
    limit: number,
  ): Promise<
    TdlibMessage[]
  >;

  sendTextMessage(
    connectionId: string,
    chatId: number,
    text: string,
  ): Promise<
    TdlibMessage
  >;
}
```

MCP tools:

```text
telegram.user.search_chats
telegram.user.get_recent_messages
telegram.user.search_messages
telegram.user.send_message
```

`send_message` must require confirmation.

Do not store the user's Telegram password in the model context or audit log.

---

# 23. MICROSOFT CONNECTOR

Create:

```text
packages/connector-microsoft/
```

Use Microsoft Graph delegated permissions for a mobile user-authorized agent.

Capabilities:

```text
microsoft.mail.read
microsoft.mail.write
microsoft.mail.send
microsoft.calendar.read
microsoft.calendar.write
microsoft.contacts.read
microsoft.contacts.write
microsoft.files.read
microsoft.files.write
microsoft.todo.read
microsoft.todo.write
microsoft.teams.read
microsoft.teams.write
```

Tools:

```text
microsoft.mail.search
microsoft.mail.get
microsoft.mail.create_draft
microsoft.mail.send_draft

microsoft.calendar.list_events
microsoft.calendar.create_event
microsoft.calendar.update_event
microsoft.calendar.delete_event

microsoft.contacts.search
microsoft.contacts.create
microsoft.contacts.update

microsoft.drive.search
microsoft.drive.download
microsoft.drive.upload
microsoft.drive.share

microsoft.todo.list
microsoft.todo.create
microsoft.todo.update
microsoft.todo.complete
```

Use the same separation as Google:

```text
McpServer
  ↓
MicrosoftConnector
  ↓
MicrosoftTokenProvider
  ↓
Graph API
```

Base Graph API client:

```typescript
export class MicrosoftGraphClient {
  constructor(
    private readonly tokens:
      AccessTokenProvider,
    private readonly http:
      ConnectorHttpClient,
  ) {}

  async request(
    connectionId: string,
    path: string,
    options: {
      method?:
        | "GET"
        | "POST"
        | "PATCH"
        | "DELETE";

      body?: unknown;
    } = {},
  ) {
    const token =
      await this.tokens
        .getValidAccessToken(
          connectionId,
        );

    const response =
      await this.http.request({
        method:
          options.method ??
          "GET",

        url:
          `https://graph.microsoft.com/v1.0${path}`,

        headers: {
          Authorization:
            `Bearer ${token}`,

          ...(options.body
            ? {
                "Content-Type":
                  "application/json",
              }
            : {}),
        },

        body:
          options.body
            ? JSON.stringify(
                options.body,
              )
            : undefined,
      });

    if (
      response.status < 200 ||
      response.status >= 300
    ) {
      throw mapProviderError(
        "microsoft",
        response,
      );
    }

    return response.text
      ? JSON.parse(
          response.text,
        )
      : null;
  }
}
```

Use PKCE and do not put a client secret in the APK.

---

# 24. SLACK CONNECTOR

Create:

```text
packages/connector-slack/
```

Slack OAuth installation returns a token associated with the installed app/workspace.

For a public mobile product, perform secret-dependent OAuth token exchange through the OAuth broker.

Connection metadata should include:

```typescript
interface SlackConnectionMetadata {
  teamId?: string;
  teamName?: string;

  enterpriseId?: string;

  tokenIdentity:
    | "bot"
    | "user";
}
```

Tools:

```text
slack.conversations.list
slack.conversations.history
slack.messages.search
slack.messages.get_thread
slack.messages.send
slack.messages.update
slack.reactions.add
```

Risk:

```text
list/history/search/thread   read
send                         external_side_effect
update                       external_side_effect
reaction                     external_side_effect
```

Do not assume a bot token and a user token have the same accessible operations.

Tool availability must be derived from granted scopes/capabilities.

---

# 25. NOTION CONNECTOR

Create:

```text
packages/connector-notion/
```

For a public Notion integration, OAuth code exchange uses integration credentials that must not be exposed inside an APK.

Use an OAuth broker.

Tools:

```text
notion.search
notion.pages.get
notion.pages.create
notion.pages.update
notion.data_sources.query
notion.comments.create
```

Connection:

```typescript
interface NotionConnectionMetadata {
  workspaceId?: string;
  workspaceName?: string;
  botId?: string;
}
```

Base API:

```typescript
export class NotionApi {
  constructor(
    private readonly tokens:
      AccessTokenProvider,
    private readonly http:
      ConnectorHttpClient,
  ) {}

  async request(
    connectionId: string,
    path: string,
    options: {
      method?:
        | "GET"
        | "POST"
        | "PATCH";

      body?: unknown;
    } = {},
  ) {
    const token =
      await this.tokens
        .getValidAccessToken(
          connectionId,
        );

    return this.http.request({
      method:
        options.method ??
        "GET",

      url:
        `https://api.notion.com/v1${path}`,

      headers: {
        Authorization:
          `Bearer ${token}`,

        "Notion-Version":
          NOTION_API_VERSION,

        ...(options.body
          ? {
              "Content-Type":
                "application/json",
            }
          : {}),
      },

      body:
        options.body
          ? JSON.stringify(
              options.body,
            )
          : undefined,
    });
  }
}
```

Keep the Notion API version in a single constant.

Do not scatter version strings through tool files.

---

# 26. TODOIST CONNECTOR

Create:

```text
packages/connector-todoist/
```

Tools:

```text
todoist.projects.list
todoist.tasks.list
todoist.tasks.get
todoist.tasks.create
todoist.tasks.update
todoist.tasks.complete
todoist.tasks.delete
todoist.comments.list
todoist.comments.create
```

Use OAuth for user accounts.

Important implementation choice:

```text
Option A:
use Todoist's supported public-client / dynamic-registration approach
if it satisfies the current app architecture.

Option B:
use your OAuth broker for the conventional client-secret flow.
```

Do not embed a client secret.

Base API:

```typescript
export class TodoistApi {
  constructor(
    private readonly tokens:
      AccessTokenProvider,
    private readonly http:
      ConnectorHttpClient,
  ) {}

  async request(
    connectionId: string,
    path: string,
    options: {
      method?:
        | "GET"
        | "POST"
        | "PATCH"
        | "DELETE";

      body?: unknown;
    } = {},
  ) {
    const token =
      await this.tokens
        .getValidAccessToken(
          connectionId,
        );

    return this.http.request({
      method:
        options.method ??
        "GET",

      url:
        `https://api.todoist.com/api/v1${path}`,

      headers: {
        Authorization:
          `Bearer ${token}`,

        ...(options.body
          ? {
              "Content-Type":
                "application/json",
            }
          : {}),
      },

      body:
        options.body
          ? JSON.stringify(
              options.body,
            )
          : undefined,
    });
  }
}
```

---

# 27. GITHUB CONNECTOR

Create:

```text
packages/connector-github/
```

For an on-device app:

- Device Flow is simple and does not require storing a user password.
- A GitHub App is preferred where fine-grained repository permissions are required.
- Do not bundle GitHub App private keys into the APK.

Tools:

```text
github.user.get
github.repositories.list
github.repositories.search
github.issues.list
github.issues.get
github.issues.create
github.issues.comment
github.pull_requests.list
github.pull_requests.get
github.pull_requests.create
github.contents.get
github.contents.update
github.actions.list_runs
```

Risk:

```text
get/list/search        read
issue create           external_side_effect
comment                external_side_effect
PR create              external_side_effect
contents update        write/external_side_effect
```

Require confirmation before:

- creating issues;
- creating comments;
- opening pull requests;
- changing repository contents.

Device-flow authorization should be implemented as an explicit connection UI, not an MCP tool that asks the model to type the code.

---

# 28. DROPBOX CONNECTOR

Create:

```text
packages/connector-dropbox/
```

Use Authorization Code + PKCE.

Tools:

```text
dropbox.files.list
dropbox.files.search
dropbox.files.get_metadata
dropbox.files.download
dropbox.files.upload
dropbox.files.create_folder
dropbox.files.create_shared_link
dropbox.files.delete
```

Large binary transfers:

```text
Dropbox
  ↓
connector downloads bytes
  ↓
app-private file
  ↓
return local URI/reference
```

Do NOT:

```text
file bytes
  ↓
base64
  ↓
JSON
  ↓
MCP
  ↓
LLM
```

unless the active task truly requires file content and the content is small.

---

# 29. DISCORD CONNECTOR

Create:

```text
packages/connector-discord/
```

Keep bot identity and OAuth user identity separate.

Connection metadata:

```typescript
interface DiscordConnectionMetadata {
  authIdentity:
    | "bot"
    | "user";

  guildIds?: string[];
}
```

Tools:

```text
discord.guilds.list
discord.channels.list
discord.messages.list
discord.messages.send
discord.messages.edit
discord.threads.create
```

Do not implement an unofficial self-bot that automates a normal account outside supported OAuth/API behavior.

Message sending requires approval during initial versions.

---

# 30. SPOTIFY CONNECTOR

Create:

```text
packages/connector-spotify/
```

Use Authorization Code + PKCE.

Tools:

```text
spotify.user.profile
spotify.search
spotify.playback.get_state
spotify.playback.play
spotify.playback.pause
spotify.playback.next
spotify.playback.previous
spotify.playback.add_to_queue
spotify.playlists.list
spotify.playlists.create
spotify.playlists.add_items
```

Capabilities depend on:

- granted scopes;
- user account;
- available active playback device;
- provider endpoint restrictions.

Do not expose a tool if prerequisites are unavailable.

For example:

```text
no playback device
  ↓
spotify.playback.play
should return a normalized
"NO_ACTIVE_DEVICE" error
rather than generic failure.
```

---

# 31. GENERIC INTENT CONNECTOR

Create:

```text
packages/connector-intents/
```

Purpose:

Use official Android inter-app mechanisms before UI automation.

Tools:

```text
intent.open_uri
intent.open_app
intent.share_text
intent.share_file
intent.compose_email
intent.open_map
intent.open_dialer
```

These call the `AndroidNativeBridge`.

Example:

```typescript
const shareTextInput =
  z.object({
    text:
      z.string()
        .min(1)
        .max(100_000),

    targetPackage:
      z.string()
        .optional(),
  });
```

The user should retain control of final recipient selection when the system share UI is used.

---

# 32. WHATSAPP FALLBACK CONNECTOR

Do not pretend that a normal WhatsApp personal account is a general-purpose OAuth API connector.

For personal mobile workflows, implement a mediated connector using Android intents/deep links/share sheet.

Tools:

```text
whatsapp.prepare_text
whatsapp.share_text
whatsapp.share_file
```

Flow:

```text
Agent chooses content
  ↓
IdentityResolver gets phone/contact
  ↓
Agent prepares action
  ↓
Approval
  ↓
Android opens supported WhatsApp flow
  ↓
User verifies target/content
  ↓
User completes send
```

Treat this as user-mediated execution.

Do not mark the task as definitely sent merely because the target application was opened.

---

# 33. UI AUTOMATION FALLBACK

This is the last fallback, not the first connector.

Use only when:

```text
1. no official API;
2. no Android Intent/deep link;
3. no share-sheet flow;
4. no supported SDK;
5. task still needs UI interaction.
```

Architecture:

```text
VLM observation
  +
Accessibility tree
  ↓
UI planner
  ↓
bounded action
  ↓
click/type/swipe/back
  ↓
verification
```

MCP tools should remain high-level:

```text
ui.open_app
ui.inspect
ui.click_element
ui.type_text
ui.swipe
ui.back
ui.wait
```

Do not expose arbitrary shell commands.

Do not allow model-generated raw Android system commands.

For release/public builds, review current Android/Google Play policy before enabling autonomous accessibility-based behavior.

---

# 34. IdentityResolver

This service is required once messaging/contact connectors exist.

```typescript
export interface IdentityCandidate {
  source:
    | "android"
    | "google"
    | "microsoft"
    | "telegram"
    | "slack"
    | "discord";

  id: string;

  displayName: string;

  email?: string;
  phone?: string;

  confidence: number;
}

export interface IdentityResolver {
  resolve(
    query: string,
    capabilities: string[],
  ): Promise<
    IdentityCandidate[]
  >;
}
```

Rules:

```text
one high-confidence match
  → proceed

several similar matches
  → ask user

no match
  → ask for missing identity information
```

Do not silently send to an arbitrary "Daniyar".

---

# 35. Normalized common models

Providers represent the same concepts differently.

Create shared normalized models.

## Message

```typescript
export interface AgentMessage {
  provider: string;

  id: string;
  conversationId: string;

  sender?: {
    id?: string;
    displayName?: string;
    address?: string;
  };

  recipients?: Array<{
    id?: string;
    displayName?: string;
    address?: string;
  }>;

  subject?: string;
  text?: string;

  createdAt?: string;

  attachments?: Array<{
    id: string;
    name: string;
    mimeType?: string;
    sizeBytes?: number;
  }>;
}
```

## Calendar event

```typescript
export interface AgentCalendarEvent {
  provider: string;

  id: string;
  calendarId?: string;

  title: string;

  start: string;
  end: string;

  timezone?: string;

  location?: string;

  attendees?: Array<{
    name?: string;
    address: string;
    status?: string;
  }>;
}
```

## File

```typescript
export interface AgentFile {
  provider: string;

  id: string;
  name: string;

  mimeType?: string;
  sizeBytes?: number;

  modifiedAt?: string;

  webUrl?: string;
  localUri?: string;
}
```

## Task

```typescript
export interface AgentTask {
  provider: string;

  id: string;
  listId?: string;

  title: string;
  description?: string;

  completed: boolean;

  dueAt?: string;
}
```

---

# 36. Tool naming convention

Use stable namespaces:

```text
android.*
google.calendar.*
google.gmail.*
google.drive.*
google.people.*
google.tasks.*

telegram.bot.*
telegram.user.*

microsoft.mail.*
microsoft.calendar.*
microsoft.contacts.*
microsoft.drive.*
microsoft.todo.*

slack.*
notion.*
todoist.*
github.*
dropbox.*
discord.*
spotify.*

intent.*
whatsapp.*
ui.*
```

Do not mix:

```text
sendGoogleMail
gmailSend
googleSendEmail
```

Use:

```text
google.gmail.send_draft
```

---

# 37. Tool argument rule

Every provider tool that uses a connected account should accept:

```typescript
connectionId: string;
```

Example:

```json
{
  "connectionId": "google-work",
  "start": "2026-08-07T09:00:00+05:00",
  "end": "2026-08-07T18:00:00+05:00"
}
```

The server validates:

```text
connection exists
  ↓
connection belongs to expected connector
  ↓
status == connected
  ↓
required capability exists
  ↓
required scope exists
  ↓
policy permits action
```

Never trust the planner to perform those checks.

---

# 38. Dynamic tool availability

Tool availability should reflect actual authorization.

Example:

```text
Google account connected
Scopes:
- calendar readonly

MCP tools:
✓ google.calendar.list_events
✓ google.calendar.get_event

✗ google.calendar.create_event
✗ google.gmail.search
✗ google.drive.search
```

After the user grants Calendar write:

```text
MCP tool list changes
  ↓
client refreshes tools
```

Implement connector/tool registry invalidation.

---

# 39. Reconnect flow

External authorization can expire or be revoked.

Normalized behavior:

```typescript
export interface ReconnectRequiredResult {
  status:
    "reconnect_required";

  connectionId: string;
  connectorId: string;

  reason: string;
}
```

When API returns an unrecoverable auth error:

```text
Tool call
  ↓
AccessTokenProvider tries refresh
  ↓
refresh fails
  ↓
connection.status =
reconnect_required
  ↓
credentials invalidated as needed
  ↓
agent receives reconnect_required
  ↓
UI shows "Reconnect Google"
```

The agent must not repeatedly retry authentication failures.

---

# 40. Rate-limit behavior

Normalize 429 responses:

```typescript
export class RateLimitError
  extends Error {
  constructor(
    readonly retryAfterMs:
      number | null,
  ) {
    super("Rate limited");
  }
}
```

The task engine may retry only when:

- retry is safe;
- action is idempotent;
- task deadline permits;
- provider supplied or policy permits a delay.

Never retry `send_message` blindly.

---

# 41. Idempotency

All write/external tools should receive an internal idempotency key.

Do not ask the LLM to invent it.

Task engine generates:

```text
taskId + stepId + stable action version
```

Example:

```text
task_482:step_03:v1
```

Maintain:

```sql
CREATE TABLE tool_executions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  arguments_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_object_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Before repeating a write:

```text
lookup idempotency_key
  ↓
already succeeded?
  → return previous normalized result
```

---

# 42. Audit log

Record:

```typescript
export interface ToolAuditRecord {
  id: string;

  taskId: string;
  agentId: string;

  connectorId: string;
  connectionId: string;

  toolName: string;

  argumentsHash: string;

  risk: ToolRisk;

  approvalId?: string;

  status:
    | "started"
    | "succeeded"
    | "failed";

  providerObjectId?: string;

  startedAt: number;
  completedAt?: number;

  errorCode?: string;
}
```

Do NOT log:

- access tokens;
- refresh tokens;
- passwords;
- Telegram 2FA password;
- Slack tokens;
- bot tokens;
- raw Authorization headers.

---

# 43. Connector bootstrap

Create:

```text
apps/mobile/src/connectors/create-connector-registry.ts
```

```typescript
export function createConnectorRegistry(
  deps: AppConnectorDependencies,
): ConnectorRegistry {
  const registry =
    new ConnectorRegistry();

  registry.register(
    new AndroidConnector(
      deps.connectionStore,
      deps.androidBridge,
    ),
  );

  registry.register(
    new GoogleConnector(
      deps.connectionStore,
      deps.google.calendar,
      deps.google.gmail,
      deps.google.drive,
      deps.google.people,
      deps.google.tasks,
    ),
  );

  registry.register(
    new TelegramBotConnector(
      deps.connectionStore,
      deps.credentialVault,
      deps.http,
    ),
  );

  registry.register(
    new TelegramUserConnector(
      deps.connectionStore,
      deps.tdlibBridge,
    ),
  );

  registry.register(
    new MicrosoftConnector(
      deps.connectionStore,
      deps.microsoftGraph,
    ),
  );

  registry.register(
    new SlackConnector(
      deps.connectionStore,
      deps.slackApi,
    ),
  );

  registry.register(
    new NotionConnector(
      deps.connectionStore,
      deps.notionApi,
    ),
  );

  registry.register(
    new TodoistConnector(
      deps.connectionStore,
      deps.todoistApi,
    ),
  );

  registry.register(
    new GitHubConnector(
      deps.connectionStore,
      deps.githubApi,
    ),
  );

  registry.register(
    new DropboxConnector(
      deps.connectionStore,
      deps.dropboxApi,
    ),
  );

  registry.register(
    new DiscordConnector(
      deps.connectionStore,
      deps.discordApi,
    ),
  );

  registry.register(
    new SpotifyConnector(
      deps.connectionStore,
      deps.spotifyApi,
    ),
  );

  registry.register(
    new IntentConnector(
      deps.connectionStore,
      deps.androidBridge,
    ),
  );

  return registry;
}
```

---

# 44. MCP bootstrap

Update the local MCP runtime initialization.

```typescript
export async function createAgentRuntime(
  deps: AppDependencies,
) {
  const connectors =
    createConnectorRegistry(
      deps,
    );

  const server =
    new McpServer({
      name:
        "mobile-agent-local-server",

      version:
        "0.2.0",
    });

  registerSystemTools(
    server,
    deps,
  );

  await registerConnectorTools(
    server,
    connectors,
    deps.policyEngine,
    deps.approvalService,
  );

  const client =
    new Client({
      name:
        "mobile-agent-client",
      version:
        "0.2.0",
    });

  const [
    clientTransport,
    serverTransport,
  ] =
    InMemoryTransport
      .createLinkedPair();

  await server.connect(
    serverTransport,
  );

  await client.connect(
    clientTransport,
  );

  return {
    server,
    client,
    connectors,
  };
}
```

When connection permissions change, rebuild/refresh the effective tool registry.

---

# 45. Connection UI

The app needs a Connected Accounts screen.

Example state:

```typescript
export interface ConnectorCardModel {
  connectorId: ConnectorId;

  title: string;

  accounts: Array<{
    connectionId: string;
    displayName: string;
    status:
      ConnectionStatus;

    capabilities:
      string[];
  }>;

  canAddAccount: boolean;
}
```

UI:

```text
Connected Accounts

Google
  Personal Gmail
  ✓ Calendar
  ✓ Contacts
  ○ Gmail
  ○ Drive

  Work Google
  ✓ Calendar
  ✓ Gmail
  ✓ Drive

Microsoft
  Work account
  ✓ Outlook
  ✓ Calendar

Telegram
  Agent Bot
  ✓ connected
```

Capability enabling should trigger incremental authorization.

---

# 46. OAuth broker interface

Create a very small remote component only for providers that require a protected client secret.

The local app calls:

```http
POST /oauth/start
```

Request:

```json
{
  "provider": "notion",
  "redirectUri": "myagent://oauth/callback",
  "requestedScopes": []
}
```

Response:

```json
{
  "authorizationUrl": "...",
  "flowId": "flow_..."
}
```

After the provider returns to the app, complete through:

```http
POST /oauth/exchange
```

Request:

```json
{
  "flowId": "flow_...",
  "code": "...",
  "state": "..."
}
```

Response should contain only the minimum needed to install credentials locally.

Better architecture where practical:

```text
Broker receives code
  ↓
exchanges using secret
  ↓
encrypts credential envelope
for this device
  ↓
mobile stores credential
```

The broker must never become an unrestricted tool-execution proxy unless that is a deliberate product architecture decision.

Providers likely needing this route include:

- Slack;
- Notion;
- conventional Todoist OAuth flow;
- some Discord OAuth configurations.

---

# 47. Native Android modules to implement

Create Kotlin modules for:

```text
AndroidCredentialVaultModule
AndroidIntentModule
AndroidContactsModule
AndroidCalendarModule
AndroidNotificationsModule
AndroidFilesModule
AndroidLocationModule
AndroidMediaModule
TdlibModule
```

Keep TypeScript connector code provider-focused.

Keep Android permission/lifecycle code in Kotlin.

---

# 48. Permission model

Create a capability matrix.

Example:

```typescript
export interface CapabilityDescriptor {
  id: string;
  title: string;

  connectorId: ConnectorId;

  osPermissions?: string[];
  oauthScopes?: string[];

  tools: string[];
}
```

Example:

```typescript
const googleCalendarRead = {
  id:
    "google.calendar.read",

  title:
    "Read Google Calendar",

  connectorId:
    "google",

  oauthScopes: [
    "CALENDAR_READ_SCOPE",
  ],

  tools: [
    "google.calendar.list_events",
    "google.calendar.get_event",
    "google.calendar.check_availability",
  ],
};
```

Keep actual provider scope constants in provider-specific files.

---

# 49. Recommended minimum scopes

Use the narrowest scopes that support the feature.

Examples from current provider APIs include:

```text
Google Tasks:
- tasks.readonly for read-only access
- tasks for write access
```

For Gmail, separate:

```text
read
compose
modify
```

Do not default to full mailbox access.

For Microsoft Graph, prefer delegated permissions for a user-controlled mobile agent.

For Dropbox and Spotify, use PKCE-compatible authorization.

For Slack/Notion, keep secrets out of the APK.

---

# 50. Testing strategy

Every connector should have:

```text
unit tests
contract tests
mock HTTP tests
auth-expiry tests
rate-limit tests
approval tests
idempotency tests
integration tests with test accounts
```

Standard connector contract test:

```typescript
describeConnector(
  "google",
  () =>
    new GoogleConnector(...),
);
```

Tests:

```text
✓ disconnected account exposes no tools
✓ missing scope hides write tool
✓ read tool executes without approval
✓ external tool requests approval
✓ wrong connectionId is rejected
✓ 401 refreshes once
✓ refresh failure sets reconnect_required
✓ 429 maps to RateLimitError
✓ token never appears in log
✓ duplicate idempotency key doesn't duplicate write
```

---

# 51. Mock connectors first

Before real OAuth, implement mock versions for every category.

Examples:

```text
MockGoogleConnector
MockTelegramConnector
MockMicrosoftConnector
MockSlackConnector
```

The planner must be tested against realistic tools before credentials are connected.

Use mock responses to build agent behavior without touching real accounts.

---

# 52. Connector implementation order

Do not implement all providers simultaneously.

Implement in this exact order:

## Phase 1 — infrastructure

```text
connector-core
ConnectionStore
CredentialVault
OAuthSessionStore
AccessTokenProvider
ConnectorHttpClient
ConnectorRegistry
PolicyEngine
ApprovalService
AuditLog
idempotency store
```

## Phase 2 — Android

```text
contacts
files
intents
notifications
apps
share sheet
calendar
```

## Phase 3 — Google

```text
Google authorization
Calendar
People
Tasks
Drive
Gmail read
Gmail drafts
Gmail send
```

## Phase 4 — Telegram

```text
Bot API
TDLib
```

## Phase 5 — Microsoft

```text
Outlook mail
Calendar
Contacts
OneDrive
To Do
```

## Phase 6 — productivity

```text
Slack
Notion
Todoist
```

## Phase 7 — developer/storage/media

```text
GitHub
Dropbox
Discord
Spotify
```

## Phase 8 — fallback

```text
generic intents
WhatsApp user-mediated
VLM/UI automation
```

---

# 53. Initial production tool set

Do not expose every possible provider endpoint to the model.

Start with:

```text
android.contacts.search
android.files.pick
android.apps.open
android.share.text

google.calendar.list_events
google.calendar.create_event
google.people.search
google.tasks.list
google.tasks.create
google.drive.search
google.gmail.search
google.gmail.create_draft
google.gmail.send_draft

telegram.bot.send_message
telegram.user.search_chats
telegram.user.send_message

microsoft.mail.search
microsoft.mail.create_draft
microsoft.mail.send_draft
microsoft.calendar.list_events
microsoft.calendar.create_event

slack.messages.search
slack.messages.send

notion.search
notion.pages.get
notion.pages.create

todoist.tasks.list
todoist.tasks.create
todoist.tasks.complete

github.repositories.list
github.issues.get
github.issues.create
github.pull_requests.get

dropbox.files.search
dropbox.files.download
dropbox.files.upload

discord.messages.list
discord.messages.send

spotify.search
spotify.playback.play
spotify.playback.pause

intent.open_uri
intent.share_text
intent.share_file
```

Add more tools only when real tasks need them.

---

# 54. Agent planning example

User:

```text
"Find a free hour tomorrow afternoon,
create a meeting with Daniyar,
then send him the details."
```

Possible tool trajectory:

```json
[
  {
    "tool": "google.calendar.list_events",
    "arguments": {
      "connectionId": "google-work",
      "start": "...",
      "end": "..."
    }
  },
  {
    "tool": "google.people.search",
    "arguments": {
      "connectionId": "google-work",
      "query": "Daniyar"
    }
  },
  {
    "tool": "google.calendar.create_event",
    "arguments": {
      "connectionId": "google-work",
      "title": "Meeting with Daniyar",
      "start": "...",
      "end": "...",
      "attendees": [
        "..."
      ]
    }
  },
  {
    "tool": "telegram.user.send_message",
    "arguments": {
      "connectionId": "telegram-personal",
      "chatId": "...",
      "text": "..."
    }
  }
]
```

The third and fourth steps should go through the approval system according to policy.

The planner does not receive any provider tokens.

---

# 55. App lifecycle

Because Android can stop the process, persist:

```text
active tasks
completed tool executions
pending approvals
connection metadata
OAuth session state
idempotency records
```

Do not rely on `InMemoryTransport` to preserve state.

On app restart:

```text
initialize stores
  ↓
initialize connectors
  ↓
load active connections
  ↓
build MCP tools
  ↓
load unfinished task
  ↓
verify previous execution status
  ↓
resume safely
```

---

# 56. Background behavior

Do not assume the React Native JavaScript runtime can run forever in the background.

Background-sensitive features need Android-native scheduling/services or remote push/event infrastructure.

Examples:

```text
new Telegram messages
new Slack messages
mail watches
calendar changes
long-running sync
```

Treat event ingestion separately from MCP tool invocation.

MCP is for agent actions and reads.

It is not automatically a reliable Android background event bus.

---

# 57. Security checklist

Before enabling real accounts:

- [ ] no client secret bundled in APK
- [ ] refresh/access tokens encrypted
- [ ] logs redact Authorization
- [ ] connection ID validated on every call
- [ ] required scopes validated server-side/local-runtime-side
- [ ] write actions have idempotency
- [ ] external effects have approval
- [ ] destructive actions have approval
- [ ] approval bound to argument hash
- [ ] provider 401 refresh occurs at most once per request
- [ ] refresh uses per-account lock
- [ ] 429 respected
- [ ] large binary files not copied into LLM context
- [ ] task state survives Android process death
- [ ] disconnect removes/invalidates credentials
- [ ] UI clearly shows connected accounts
- [ ] user can revoke individual capability groups
- [ ] tool list reflects currently granted capabilities

---

# 58. Acceptance criteria per connector

A connector is complete only when:

- [ ] account can be connected
- [ ] connection survives app restart
- [ ] account can be disconnected
- [ ] expired auth becomes `reconnect_required`
- [ ] granted scopes are persisted
- [ ] tools match scopes
- [ ] read tool works
- [ ] write tool works
- [ ] approval behavior works
- [ ] rate-limit behavior is normalized
- [ ] provider errors are sanitized
- [ ] credentials never appear in MCP result
- [ ] credentials never appear in model context
- [ ] integration test uses a non-primary/test account where possible
- [ ] task engine can call connector through MCP
- [ ] direct provider calls from planner are impossible

---

# 59. Global acceptance criteria

The connector platform is ready when this full scenario works:

```text
1. Open app.
2. Connect Google.
3. Grant Calendar only.
4. MCP exposes Calendar tools but no Gmail tools.
5. Ask chat for tomorrow's schedule.
6. Agent calls Calendar read tool.
7. Enable Gmail capability.
8. Complete incremental authorization.
9. MCP exposes Gmail read/draft tools.
10. Ask agent to draft an email.
11. Agent creates draft.
12. Ask agent to send it.
13. Approval UI shows recipient + subject + body.
14. User approves.
15. Agent sends exact approved draft.
16. Audit log records result without token data.
17. Kill Android process.
18. Reopen app.
19. Connections restore.
20. MCP tools restore.
21. Disconnect Google.
22. Credential removed.
23. Google tools disappear.
```

After that works, repeat the same pattern for:

```text
Telegram
Microsoft
Slack
Notion
Todoist
GitHub
Dropbox
Discord
Spotify
```

---

# 60. Current provider implementation notes

Use the latest provider documentation while implementing individual adapters.

The current architecture assumptions that matter are:

- Google Workspace APIs use OAuth scopes and permissions should be requested as narrowly as possible.
- Gmail separates read/modify/compose-style access and sending should remain an explicitly controlled action.
- Google Tasks exposes read-only and read/write scopes.
- Google Drive supports narrower file-oriented access patterns; avoid requesting unrestricted Drive access without need.
- Microsoft Graph supports delegated permissions for a signed-in user's mail, calendar, contacts and files.
- Slack uses OAuth installations and granular app scopes.
- Notion public connections use OAuth; token exchange/refresh uses integration credentials that must remain secret.
- Todoist supports OAuth and its current platform includes agent/MCP-oriented authorization options; still keep any secret-requiring flow outside the APK.
- GitHub supports device flow and recommends GitHub Apps where fine-grained permissions are appropriate.
- Dropbox recommends PKCE for mobile/public clients that cannot protect a client secret.
- Discord distinguishes bot-token identity and OAuth user-token identity.
- Spotify recommends Authorization Code with PKCE for mobile/public clients.
- Android Storage Access Framework provides user-mediated document access without broad storage permission.
- Android NotificationListenerService requires explicit notification-listener access.

---

# 61. Do not implement

Do NOT add:

```text
shell.execute
terminal.run
android.exec
raw_sql
generic_http_request
provider.call_any_endpoint
oauth.get_raw_token
vault.dump
```

These tools are too broad for an autonomous agent.

Expose narrow semantic tools.

Good:

```text
google.calendar.create_event
```

Bad:

```text
http.request({
  url: "anything",
  headers: "anything"
})
```

Good:

```text
github.issues.create
```

Bad:

```text
github.raw_rest_call
```

---

# 62. Final target

The completed architecture should look like this:

```text
                    ┌──────────────────┐
                    │ Chat / Agent UI  │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Planner / VLM    │
                    └────────┬─────────┘
                             │
                    MCP tools only
                             │
                             ▼
                    ┌──────────────────┐
                    │ Local MCP Client │
                    └────────┬─────────┘
                             │
                      InMemoryTransport
                             │
                             ▼
                    ┌──────────────────┐
                    │ Local MCP Server │
                    └────────┬─────────┘
                             │
                  ┌──────────┴──────────┐
                  │ Policy + Approval   │
                  └──────────┬──────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ ConnectorRegistry│
                    └────────┬─────────┘
                             │
       ┌──────────┬──────────┼───────────┬───────────┐
       ▼          ▼          ▼           ▼           ▼
    Android     Google    Telegram    Microsoft   Productivity
       │          │          │           │           │
       ▼          ▼          ▼           ▼           ▼
   Native API   OAuth     Bot/TDLib     Graph    Slack/Notion/
                                               Todoist/etc.
                             │
                             ▼
                    ┌──────────────────┐
                    │ CredentialVault  │
                    │ Android Keystore │
                    └──────────────────┘
```

The agent should know **what it is allowed to do**, but should never know **the credentials that make it possible**.

That is the core rule for every connector in this project.
