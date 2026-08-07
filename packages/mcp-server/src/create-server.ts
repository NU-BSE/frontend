import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type {
  CalendarEvent,
  MobileAgentDependencies,
} from "@mobile-agent/connector-core";

const connectionIdSchema = z
  .string()
  .min(1)
  .max(200)
  .describe("ID подключённого аккаунта пользователя");

const isoDateSchema = z
  .string()
  .datetime({ offset: true })
  .describe("Дата и время ISO 8601 с часовым поясом");

const calendarEventSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  start: z.string(),
  end: z.string(),
  htmlLink: z.string().optional(),
});

function textResult(text: string) {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}

function toolError(message: string) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
  };
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    /*
     * В production не возвращай модели внутренний stack trace,
     * OAuth-токены, HTTP headers или подробности базы.
     */
    return error.message;
  }

  return "Unknown connector error";
}

export function createMobileAgentMcpServer(
  dependencies: MobileAgentDependencies,
): McpServer {
  const server = new McpServer({
    name: "mobile-agent-local-server",
    version: "0.1.0",
  });

  /*
   * Простой системный инструмент.
   * Нужен, чтобы проверить соединение client ↔ server.
   */
  server.registerTool(
    "system.health",
    {
      description: "Check whether the local MCP server is running",
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
        ...textResult("Local MCP server is running"),
        structuredContent: output,
      };
    },
  );

  /*
   * Получение событий.
   * Это read-only операция, подтверждение не нужно.
   */
  server.registerTool(
    "calendar.list_events",
    {
      description:
        "List events from one connected calendar account in a time range",

      inputSchema: z.object({
        connectionId: connectionIdSchema,
        start: isoDateSchema,
        end: isoDateSchema,

        maxResults: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20),
      }),

      outputSchema: z.object({
        events: z.array(calendarEventSchema),
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
        const startDate = new Date(start);
        const endDate = new Date(end);

        if (startDate >= endDate) {
          return toolError(
            "The start time must be earlier than the end time",
          );
        }

        const events = await dependencies.calendar.listEvents({
          connectionId,
          start,
          end,
          maxResults,
        });

        const output = {
          events,
        };

        return {
          content: [
            {
              type: "text",
              text:
                events.length === 0
                  ? "No calendar events found"
                  : JSON.stringify(events),
            },
          ],
          structuredContent: output,
        };
      } catch (error) {
        return toolError(sanitizeError(error));
      }
    },
  );

  /*
   * Создание события.
   * Перед выполнением проверяется approvalId.
   */
  server.registerTool(
    "calendar.create_event",
    {
      description:
        "Create a calendar event after explicit user approval",

      inputSchema: z.object({
        connectionId: connectionIdSchema,

        title: z
          .string()
          .trim()
          .min(1)
          .max(300),

        description: z
          .string()
          .max(10_000)
          .optional(),

        start: isoDateSchema,
        end: isoDateSchema,

        approvalId: z
          .string()
          .min(1)
          .describe(
            "One-time approval ID issued after user confirmation",
          ),

        idempotencyKey: z
          .string()
          .min(1)
          .max(200)
          .describe(
            "Stable ID preventing duplicate event creation",
          ),
      }),

      outputSchema: z.object({
        event: calendarEventSchema,
      }),

      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      connectionId,
      title,
      description,
      start,
      end,
      approvalId,
      idempotencyKey,
    }) => {
      try {
        if (new Date(start) >= new Date(end)) {
          return toolError(
            "The event start must be earlier than its end",
          );
        }

        const payload: Record<string, unknown> = {
          connectionId,
          title,
          start,
          end,
        };

        if (description !== undefined) {
          payload.description = description;
        }

        /*
         * Approval должен быть привязан к точному payload.
         * Модель не должна иметь возможность изменить title,
         * время или connectionId после подтверждения.
         */
        await dependencies.approvals.assertApproved({
          approvalId,
          toolName: "calendar.create_event",
          payload,
        });

        const createInput = {
          connectionId,
          title,
          start,
          end,
          idempotencyKey,
          ...(description !== undefined
            ? { description }
            : {}),
        };

        const event: CalendarEvent =
          await dependencies.calendar.createEvent(createInput);

        return {
          content: [
            {
              type: "text",
              text: `Calendar event created: ${event.title}`,
            },
          ],
          structuredContent: {
            event,
          },
        };
      } catch (error) {
        return toolError(sanitizeError(error));
      }
    },
  );

  return server;
}