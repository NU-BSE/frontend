# LOCAL_MCP_SETUP.md

## Задача

Настроить в мобильном TypeScript-приложении локальный MCP runtime:

- MCP Client работает внутри приложения;
- MCP Server работает внутри того же JavaScript-процесса;
- соединение выполняется через `InMemoryTransport`;
- сеть, localhost, отдельный Node.js-процесс и `child_process` не используются;
- MCP Server предоставляет инструменты агенту;
- бизнес-логика приложений находится в connectors, а не внутри MCP Client;
- OAuth-токены не передаются модели и не включаются в MCP tool arguments.

Первая версия должна предоставить два инструмента:

1. `system.health`
2. `calendar.list_events`

На первом этапе календарь должен быть mock-реализацией. Реальный Google Calendar подключается после проверки MCP runtime в Android development build и release APK.

---

## Важное ограничение

Официальный TypeScript MCP SDK поддерживает Node.js, Bun и Deno. React Native/Hermes не заявлен как отдельный официально поддерживаемый runtime.

Поэтому настройку нужно выполнять в два этапа:

1. Сделать минимальный compatibility spike с `system.health`.
2. Только после успешного запуска в Android APK добавлять connectors, OAuth и agent loop.

Если официальный SDK не собирается под React Native/Hermes, сохранить описанные ниже интерфейсы `AgentToolClient`, `Connector` и `ToolExecutor`, а MCP transport временно заменить внутренним Tool Registry.

---

# 1. Целевая архитектура

```text
Chat UI
   ↓
Agent Planner
   ↓
AgentMcpClient
   ↓
MCP Client
   ↓ InMemoryTransport
MCP Server
   ↓
Tool handlers
   ↓
ConnectorRegistry
   ├── MockCalendarConnector
   ├── GoogleCalendarConnector
   ├── TelegramConnector
   └── AndroidConnector
   ↓
CredentialVault / Android Keystore
```

MCP не должен хранить всю историю чата, screenshots или RL trajectories.

В оперативной памяти остаются:

- MCP Client;
- MCP Server;
- зарегистрированные schemas;
- активная задача;
- текущие tool calls.

В SQLite или файловом хранилище остаются:

- история чата;
- checkpoints;
- audit log;
- trajectories;
- крупные tool results;
- screenshots.

---

# 2. Структура monorepo

Создать следующую структуру в корне репозитория приложения:

```text
mobile-agent/
├── apps/
│   └── mobile/
│       ├── package.json
│       └── src/
│           ├── mcp/
│           │   ├── runtime-singleton.ts
│           │   └── use-agent-tools.ts
│           └── ...
│
├── packages/
│   ├── connector-core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── contracts.ts
│   │       └── index.ts
│   │
│   ├── connector-mock/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── mock-calendar-connector.ts
│   │       └── index.ts
│   │
│   ├── mcp-server/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── create-server.ts
│   │       └── index.ts
│   │
│   └── mcp-client/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── agent-mcp-client.ts
│           ├── create-local-runtime.ts
│           └── index.ts
│
├── package.json
└── tsconfig.base.json
```

Не создавать и не редактировать файлы вручную внутри `node_modules`.

---

# 3. Корневой package.json

Файл:

```text
package.json
```

Содержимое:

```json
{
  "name": "mobile-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present",
    "build": "npm run build --workspaces --if-present"
  },
  "devDependencies": {
    "typescript": "^5.9.0"
  }
}
```

Если существующий root `package.json` уже содержит scripts и dependencies, не заменять его целиком. Добавить только:

```json
{
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
```

---

# 4. Базовая TypeScript-конфигурация

Файл:

```text
tsconfig.base.json
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

Для React Native/Expo предпочтительнее `moduleResolution: "Bundler"`.

Если проект уже использует собственный `tsconfig`, не ломать текущую конфигурацию. Использовать существующий base config и добавить только необходимые workspace paths.

---

# 5. Установка MCP SDK

Выполнить из корня проекта:

```bash
npm install @modelcontextprotocol/server @modelcontextprotocol/client zod
```

Пакеты должны быть установлены через package manager. Не копировать их код вручную в `node_modules`.

---

# 6. connector-core

## 6.1 package.json

Файл:

```text
packages/connector-core/package.json
```

```json
{
  "name": "@mobile-agent/connector-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

## 6.2 tsconfig.json

Файл:

```text
packages/connector-core/tsconfig.json
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": [
    "src/**/*.ts"
  ]
}
```

## 6.3 contracts.ts

Файл:

```text
packages/connector-core/src/contracts.ts
```

```typescript
export interface CalendarEvent {
  id: string;
  connectionId: string;
  title: string;
  start: string;
  end: string;
  description?: string;
}

export interface ListCalendarEventsInput {
  connectionId: string;
  start: string;
  end: string;
  maxResults: number;
}

export interface CalendarConnector {
  listEvents(
    input: ListCalendarEventsInput,
  ): Promise<CalendarEvent[]>;
}

export interface AgentConnectorDependencies {
  calendar: CalendarConnector;
}
```

## 6.4 index.ts

Файл:

```text
packages/connector-core/src/index.ts
```

```typescript
export type {
  AgentConnectorDependencies,
  CalendarConnector,
  CalendarEvent,
  ListCalendarEventsInput,
} from "./contracts.js";
```

---

# 7. Mock connector

## 7.1 package.json

Файл:

```text
packages/connector-mock/package.json
```

```json
{
  "name": "@mobile-agent/connector-mock",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mobile-agent/connector-core": "*"
  }
}
```

## 7.2 tsconfig.json

Файл:

```text
packages/connector-mock/tsconfig.json
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": [
    "src/**/*.ts"
  ]
}
```

## 7.3 mock-calendar-connector.ts

Файл:

```text
packages/connector-mock/src/mock-calendar-connector.ts
```

```typescript
import type {
  CalendarConnector,
  CalendarEvent,
  ListCalendarEventsInput,
} from "@mobile-agent/connector-core";

const MOCK_EVENTS: CalendarEvent[] = [
  {
    id: "event-1",
    connectionId: "mock-personal",
    title: "MCP test meeting",
    start: "2026-08-07T10:00:00+05:00",
    end: "2026-08-07T11:00:00+05:00",
  },
];

export class MockCalendarConnector
  implements CalendarConnector
{
  async listEvents(
    input: ListCalendarEventsInput,
  ): Promise<CalendarEvent[]> {
    const rangeStart = new Date(input.start).getTime();
    const rangeEnd = new Date(input.end).getTime();

    if (
      !Number.isFinite(rangeStart) ||
      !Number.isFinite(rangeEnd)
    ) {
      throw new Error("Invalid date range");
    }

    if (rangeStart >= rangeEnd) {
      throw new Error(
        "start must be earlier than end",
      );
    }

    return MOCK_EVENTS
      .filter((event) => {
        if (
          event.connectionId !==
          input.connectionId
        ) {
          return false;
        }

        const eventStart =
          new Date(event.start).getTime();

        const eventEnd =
          new Date(event.end).getTime();

        return (
          eventStart < rangeEnd &&
          eventEnd > rangeStart
        );
      })
      .slice(0, input.maxResults);
  }
}
```

## 7.4 index.ts

Файл:

```text
packages/connector-mock/src/index.ts
```

```typescript
export {
  MockCalendarConnector,
} from "./mock-calendar-connector.js";
```

---

# 8. mcp-server

## 8.1 package.json

Файл:

```text
packages/mcp-server/package.json
```

```json
{
  "name": "@mobile-agent/mcp-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mobile-agent/connector-core": "*",
    "@modelcontextprotocol/server": "*",
    "zod": "*"
  }
}
```

## 8.2 tsconfig.json

Файл:

```text
packages/mcp-server/tsconfig.json
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": [
    "src/**/*.ts"
  ]
}
```

## 8.3 create-server.ts

Файл:

```text
packages/mcp-server/src/create-server.ts
```

```typescript
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type {
  AgentConnectorDependencies,
} from "@mobile-agent/connector-core";

function createTextResult(
  text: string,
): {
  content: Array<{
    type: "text";
    text: string;
  }>;
} {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}

function createToolError(
  error: unknown,
): {
  isError: true;
  content: Array<{
    type: "text";
    text: string;
  }>;
} {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown tool error";

  return {
    isError: true,
    content: [
      {
        type: "text",
        text: message,
      },
    ],
  };
}

export function createMobileAgentMcpServer(
  dependencies: AgentConnectorDependencies,
): McpServer {
  const server = new McpServer({
    name: "mobile-agent-local-server",
    version: "0.1.0",
    description:
      "Local tools used by the mobile agent",
  });

  server.registerTool(
    "system.health",
    {
      description:
        "Check whether the local MCP server is available",

      inputSchema: z.object({}),

      outputSchema: z.object({
        status: z.literal("ok"),
        timestamp: z.string(),
      }),

      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const output = {
        status: "ok" as const,
        timestamp: new Date().toISOString(),
      };

      return {
        ...createTextResult(
          "Local MCP server is running",
        ),
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "calendar.list_events",
    {
      description:
        "List events from one connected calendar account",

      inputSchema: z.object({
        connectionId: z
          .string()
          .min(1)
          .max(200),

        start: z
          .string()
          .datetime({
            offset: true,
          }),

        end: z
          .string()
          .datetime({
            offset: true,
          }),

        maxResults: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20),
      }),

      outputSchema: z.object({
        events: z.array(
          z.object({
            id: z.string(),
            connectionId: z.string(),
            title: z.string(),
            start: z.string(),
            end: z.string(),
            description: z
              .string()
              .optional(),
          }),
        ),
      }),

      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      connectionId,
      start,
      end,
      maxResults,
    }) => {
      try {
        const events =
          await dependencies.calendar.listEvents({
            connectionId,
            start,
            end,
            maxResults,
          });

        return {
          content: [
            {
              type: "text",
              text:
                events.length === 0
                  ? "No events found"
                  : JSON.stringify(events),
            },
          ],
          structuredContent: {
            events,
          },
        };
      } catch (error) {
        return createToolError(error);
      }
    },
  );

  return server;
}
```

## 8.4 index.ts

Файл:

```text
packages/mcp-server/src/index.ts
```

```typescript
export {
  createMobileAgentMcpServer,
} from "./create-server.js";
```

---

# 9. mcp-client

## 9.1 package.json

Файл:

```text
packages/mcp-client/package.json
```

```json
{
  "name": "@mobile-agent/mcp-client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mobile-agent/connector-core": "*",
    "@mobile-agent/mcp-server": "*",
    "@modelcontextprotocol/client": "*",
    "zod": "*"
  }
}
```

## 9.2 tsconfig.json

Файл:

```text
packages/mcp-client/tsconfig.json
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": [
    "src/**/*.ts"
  ]
}
```

## 9.3 agent-mcp-client.ts

Файл:

```text
packages/mcp-client/src/agent-mcp-client.ts
```

```typescript
import type {
  Client,
} from "@modelcontextprotocol/client";

import * as z from "zod/v4";

const healthResultSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string(),
});

const calendarEventSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  description: z.string().optional(),
});

const listEventsResultSchema = z.object({
  events: z.array(
    calendarEventSchema,
  ),
});

export interface AgentToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export class AgentMcpClient {
  constructor(
    private readonly client: Client,
  ) {}

  async listTools() {
    const response =
      await this.client.listTools();

    return response.tools;
  }

  async callTool(
    call: AgentToolCall,
  ) {
    const result =
      await this.client.callTool({
        name: call.name,
        arguments: call.arguments,
      });

    if (result.isError) {
      const message = result.content
        .filter(
          (
            item,
          ): item is {
            type: "text";
            text: string;
          } => item.type === "text",
        )
        .map((item) => item.text)
        .join("\n");

      throw new Error(
        message || `Tool ${call.name} failed`,
      );
    }

    return result;
  }

  async health() {
    const result =
      await this.callTool({
        name: "system.health",
        arguments: {},
      });

    return healthResultSchema.parse(
      result.structuredContent,
    );
  }

  async listCalendarEvents(
    input: {
      connectionId: string;
      start: string;
      end: string;
      maxResults?: number;
    },
  ) {
    const result =
      await this.callTool({
        name: "calendar.list_events",
        arguments: {
          connectionId:
            input.connectionId,
          start: input.start,
          end: input.end,
          maxResults:
            input.maxResults ?? 20,
        },
      });

    return listEventsResultSchema.parse(
      result.structuredContent,
    );
  }
}
```

## 9.4 create-local-runtime.ts

Файл:

```text
packages/mcp-client/src/create-local-runtime.ts
```

```typescript
import {
  Client,
  InMemoryTransport,
} from "@modelcontextprotocol/client";

import type {
  AgentConnectorDependencies,
} from "@mobile-agent/connector-core";

import {
  createMobileAgentMcpServer,
} from "@mobile-agent/mcp-server";

import {
  AgentMcpClient,
} from "./agent-mcp-client.js";

export interface LocalMcpRuntime {
  rawClient: Client;
  mcp: AgentMcpClient;
  close(): Promise<void>;
}

export async function createLocalMcpRuntime(
  dependencies: AgentConnectorDependencies,
): Promise<LocalMcpRuntime> {
  const server =
    createMobileAgentMcpServer(
      dependencies,
    );

  const rawClient = new Client({
    name: "mobile-agent-local-client",
    version: "0.1.0",
  });

  /*
   * Важно:
   * обе половины linked pair создаются
   * одним импортом InMemoryTransport.
   */
  const [
    clientTransport,
    serverTransport,
  ] =
    InMemoryTransport.createLinkedPair();

  await server.connect(
    serverTransport,
  );

  await rawClient.connect(
    clientTransport,
  );

  const mcp =
    new AgentMcpClient(rawClient);

  let closed = false;

  return {
    rawClient,
    mcp,

    async close(): Promise<void> {
      if (closed) {
        return;
      }

      closed = true;

      await rawClient.close();
      await server.close();
    },
  };
}
```

## 9.5 index.ts

Файл:

```text
packages/mcp-client/src/index.ts
```

```typescript
export {
  AgentMcpClient,
} from "./agent-mcp-client.js";

export {
  createLocalMcpRuntime,
} from "./create-local-runtime.js";

export type {
  AgentToolCall,
} from "./agent-mcp-client.js";

export type {
  LocalMcpRuntime,
} from "./create-local-runtime.js";
```

---

# 10. Подключение packages к mobile app

В `apps/mobile/package.json` добавить:

```json
{
  "dependencies": {
    "@mobile-agent/connector-core": "*",
    "@mobile-agent/connector-mock": "*",
    "@mobile-agent/mcp-client": "*",
    "@mobile-agent/mcp-server": "*"
  }
}
```

Не удалять существующие dependencies.

После изменения выполнить из корня:

```bash
npm install
```

---

# 11. Singleton MCP runtime

Не создавать MCP Client и MCP Server при каждом сообщении в чате.

Файл:

```text
apps/mobile/src/mcp/runtime-singleton.ts
```

```typescript
import {
  createLocalMcpRuntime,
  type LocalMcpRuntime,
} from "@mobile-agent/mcp-client";

import {
  MockCalendarConnector,
} from "@mobile-agent/connector-mock";

let runtimePromise:
  Promise<LocalMcpRuntime> | null = null;

export function getLocalMcpRuntime():
  Promise<LocalMcpRuntime> {
  if (!runtimePromise) {
    runtimePromise =
      createLocalMcpRuntime({
        calendar:
          new MockCalendarConnector(),
      }).catch((error) => {
        /*
         * Разрешаем повторную инициализацию,
         * если первый запуск завершился ошибкой.
         */
        runtimePromise = null;
        throw error;
      });
  }

  return runtimePromise;
}

export async function closeLocalMcpRuntime():
  Promise<void> {
  if (!runtimePromise) {
    return;
  }

  const runtime =
    await runtimePromise;

  await runtime.close();

  runtimePromise = null;
}
```

---

# 12. Compatibility spike в Android-приложении

Добавить временную функцию:

```text
apps/mobile/src/mcp/run-mcp-spike.ts
```

```typescript
import {
  getLocalMcpRuntime,
} from "./runtime-singleton";

export async function runMcpSpike() {
  const runtime =
    await getLocalMcpRuntime();

  const health =
    await runtime.mcp.health();

  const tools =
    await runtime.mcp.listTools();

  const events =
    await runtime.mcp.listCalendarEvents({
      connectionId:
        "mock-personal",

      start:
        "2026-08-07T00:00:00+05:00",

      end:
        "2026-08-08T00:00:00+05:00",
    });

  return {
    health,
    toolNames:
      tools.map((tool) => tool.name),
    events: events.events,
  };
}
```

Временно вызвать её из debug screen или development-only кнопки:

```typescript
const result = await runMcpSpike();

console.log(
  "MCP SPIKE RESULT",
  result,
);
```

Ожидаемый результат:

```json
{
  "health": {
    "status": "ok",
    "timestamp": "..."
  },
  "toolNames": [
    "system.health",
    "calendar.list_events"
  ],
  "events": [
    {
      "id": "event-1",
      "connectionId": "mock-personal",
      "title": "MCP test meeting",
      "start": "2026-08-07T10:00:00+05:00",
      "end": "2026-08-07T11:00:00+05:00"
    }
  ]
}
```

---

# 13. Интеграция с agent planner

Planner должен получать не handlers и не tokens, а MCP tool definitions:

```typescript
const runtime =
  await getLocalMcpRuntime();

const tools =
  await runtime.mcp.listTools();

const modelTools =
  tools.map((tool) => ({
    name: tool.name,
    description:
      tool.description,
    inputSchema:
      tool.inputSchema,
  }));
```

Пример результата модели:

```json
{
  "type": "tool_call",
  "name": "calendar.list_events",
  "arguments": {
    "connectionId": "mock-personal",
    "start": "2026-08-07T00:00:00+05:00",
    "end": "2026-08-08T00:00:00+05:00",
    "maxResults": 20
  }
}
```

Выполнение:

```typescript
const result =
  await runtime.mcp.callTool({
    name: decision.name,
    arguments:
      decision.arguments,
  });
```

Agent loop:

```typescript
async function executeAgentTurn(
  userMessage: string,
) {
  const runtime =
    await getLocalMcpRuntime();

  const tools =
    await runtime.mcp.listTools();

  const decision =
    await planner.plan({
      userMessage,
      tools,
    });

  if (
    decision.type === "finish"
  ) {
    return {
      type: "message",
      text: decision.text,
    };
  }

  if (
    decision.type === "tool_call"
  ) {
    const result =
      await runtime.mcp.callTool({
        name: decision.name,
        arguments:
          decision.arguments,
      });

    return {
      type: "tool_result",
      toolName:
        decision.name,
      result,
    };
  }

  throw new Error(
    "Unsupported planner decision",
  );
}
```

---

# 14. Правила для connectors

Каждый внешний сервис реализуется как connector.

MCP handler не должен:

- открывать OAuth UI;
- хранить refresh tokens;
- читать Redux state;
- напрямую работать с React components;
- содержать agent planning;
- принимать access token в tool arguments.

Правильная схема:

```text
MCP tool
  ↓
Connector interface
  ↓
CredentialVault
  ↓
Provider API
```

Пример будущего Google Calendar connector:

```typescript
export interface AccessTokenProvider {
  getValidAccessToken(
    connectionId: string,
  ): Promise<string>;
}

export class GoogleCalendarConnector
  implements CalendarConnector
{
  constructor(
    private readonly tokens:
      AccessTokenProvider,
  ) {}

  async listEvents(
    input: ListCalendarEventsInput,
  ): Promise<CalendarEvent[]> {
    const accessToken =
      await this.tokens
        .getValidAccessToken(
          input.connectionId,
        );

    /*
     * Здесь выполняется Google API request.
     * accessToken не возвращается MCP Client
     * и не попадает в model context.
     */

    return [];
  }
}
```

---

# 15. OAuth и credentials

В tool arguments передавать только:

```json
{
  "connectionId": "google-personal"
}
```

Никогда не передавать:

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "clientSecret": "..."
}
```

Credential storage:

```text
SQLite:
- connectionId
- provider
- accountName
- scopes
- status
- credentialReference

Android Keystore-backed vault:
- encryption key
- encrypted access token
- encrypted refresh token
- expiry
```

Для первой mock-версии CredentialVault не нужен.

---

# 16. Metro и workspaces

Сначала проверить, видит ли Metro workspace packages без дополнительной конфигурации.

Если imports вида:

```typescript
import {
  createLocalMcpRuntime,
} from "@mobile-agent/mcp-client";
```

не разрешаются, добавить или обновить:

```text
apps/mobile/metro.config.js
```

Пример для Expo:

```javascript
const path =
  require("path");

const {
  getDefaultConfig,
} =
  require("expo/metro-config");

const projectRoot =
  __dirname;

const workspaceRoot =
  path.resolve(
    projectRoot,
    "../..",
  );

const config =
  getDefaultConfig(
    projectRoot,
  );

config.watchFolders = [
  workspaceRoot,
];

config.resolver.nodeModulesPaths = [
  path.resolve(
    projectRoot,
    "node_modules",
  ),

  path.resolve(
    workspaceRoot,
    "node_modules",
  ),
];

module.exports = config;
```

Не добавлять этот файл автоматически, если существующий Metro config уже корректно поддерживает workspaces.

---

# 17. Возможные ошибки

## Ошибка: module not found

Проверить:

```bash
npm install
npm run typecheck
```

Проверить, что root package.json содержит:

```json
{
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
```

## Ошибка: package uses unsupported Node API

Это означает, что текущая версия SDK или одна из зависимостей использует API, которого нет в React Native/Hermes.

Не пытаться хаотично добавлять десятки Node polyfills.

Сначала определить конкретный отсутствующий API.

Если проблема небольшая и безопасная, добавить ограниченный polyfill.

Если SDK требует существенные Node internals, использовать fallback Tool Registry до перехода на:

- embedded Node runtime;
- localhost process;
- remote MCP;
- совместимый transport.

## Ошибка: client connects, but tool list is empty

Проверить, что tools регистрируются до:

```typescript
server.connect(
  serverTransport,
);
```

## Ошибка: duplicated server

Проверить, что runtime создаётся через singleton и не пересоздаётся при каждом React render.

## Ошибка: tool result isError

Не считать это transport error.

`isError: true` означает, что MCP transport работает, но сам tool handler вернул ошибку.

## Ошибка: TypeScript конфликтует с exactOptionalPropertyTypes

Не передавать property со значением `undefined`.

Использовать conditional spread:

```typescript
const result = {
  id,
  ...(description !== undefined
    ? { description }
    : {}),
};
```

---

# 18. Security requirements

Даже локальный MCP должен выполнять следующие правила:

1. Модель не получает OAuth tokens.
2. Tool handler повторно валидирует arguments.
3. Write actions требуют approval.
4. External side effects имеют idempotency key.
5. Tool results не содержат stack trace и secrets.
6. Audit log хранит tool name, arguments hash, status и timestamp.
7. Disconnect удаляет credentials и отключает tools.
8. Screenshots и большие файлы не передаются через MCP без необходимости.
9. Локальный runtime создаётся один раз на активную сессию приложения.
10. После завершения приложения runtime корректно закрывается.

---

# 19. Acceptance criteria

Настройка считается готовой, когда выполнены все пункты:

- [ ] `npm install` завершается успешно.
- [ ] `npm run typecheck` завершается без ошибок.
- [ ] Workspace imports разрешаются Metro bundler.
- [ ] Android development build запускается.
- [ ] `system.health` возвращает `status: "ok"`.
- [ ] `listTools()` содержит `system.health`.
- [ ] `listTools()` содержит `calendar.list_events`.
- [ ] `calendar.list_events` возвращает mock event.
- [ ] Невалидная дата возвращает tool error.
- [ ] MCP runtime не создаётся повторно при React re-render.
- [ ] Client и server корректно закрываются.
- [ ] Android release APK собирается.
- [ ] В logs отсутствуют OAuth tokens и secrets.
- [ ] В model context отсутствуют OAuth tokens и secrets.

---

# 20. Следующий этап

После выполнения acceptance criteria:

1. Создать `connector-google`.
2. Реализовать локальный Connection Store.
3. Реализовать Android Keystore-backed Credential Vault.
4. Подключить Google authorization.
5. Заменить `MockCalendarConnector` на `GoogleCalendarConnector`.
6. Добавить `calendar.create_event`.
7. Добавить Approval Service.
8. Добавить idempotency protection.
9. Подключить tools к agent planner.
10. После этого добавлять Telegram, Gmail, Drive и Android system connectors.

---

# 21. Что не нужно делать на первом этапе

Не делать сразу:

- localhost HTTP server;
- отдельный Node.js-процесс;
- embedded Node runtime;
- Google OAuth;
- Gmail;
- Telegram TDLib;
- RL training;
- VLM screenshot pipeline;
- dynamic plugin loading;
- десятки MCP tools.

Сначала доказать один минимальный путь:

```text
Android app
  → MCP Client
  → InMemoryTransport
  → MCP Server
  → system.health
  → structured result
```

Затем:

```text
Android app
  → MCP Client
  → MCP Server
  → MockCalendarConnector
  → calendar.list_events
```

Только после этого подключать реальные сервисы.
