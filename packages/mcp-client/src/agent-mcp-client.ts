import { Client } from "@modelcontextprotocol/client";
import * as z from "zod/v4";

const calendarEventSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  start: z.string(),
  end: z.string(),
  htmlLink: z.string().optional(),
});

const listEventsResultSchema = z.object({
  events: z.array(calendarEventSchema),
});

const createEventResultSchema = z.object({
  event: calendarEventSchema,
});

export interface RawToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export class ToolExecutionError extends Error {
  readonly toolName: string;

  constructor(toolName: string, message: string) {
    super(message);

    this.name = "ToolExecutionError";
    this.toolName = toolName;
  }
}

function extractText(
  content: Awaited<
    ReturnType<Client["callTool"]>
  >["content"],
): string {
  const lines: string[] = [];

  for (const block of content) {
    if (block.type === "text") {
      lines.push(block.text);
    }
  }

  return lines.join("\n") || "Tool execution failed";
}

export class AgentMcpClient {
  constructor(
    private readonly client: Client,
  ) {}

  /**
   * Список инструментов для передачи planner/LLM.
   */
  async listTools() {
    const result = await this.client.listTools();

    return result.tools;
  }

  /**
   * Универсальный вызов.
   *
   * Его можно использовать напрямую с tool call,
   * который вернула модель.
   */
  async callTool(call: RawToolCall) {
    const result = await this.client.callTool({
      name: call.name,
      arguments: call.arguments,
    });

    if (result.isError) {
      throw new ToolExecutionError(
        call.name,
        extractText(result.content),
      );
    }

    return result;
  }

  async health(): Promise<{
    status: "ok";
    timestamp: string;
  }> {
    const result = await this.callTool({
      name: "system.health",
      arguments: {},
    });

    return z
      .object({
        status: z.literal("ok"),
        timestamp: z.string(),
      })
      .parse(result.structuredContent);
  }

  async listCalendarEvents(input: {
    connectionId: string;
    start: string;
    end: string;
    maxResults?: number;
  }) {
    const result = await this.callTool({
      name: "calendar.list_events",

      arguments: {
        connectionId: input.connectionId,
        start: input.start,
        end: input.end,
        maxResults: input.maxResults ?? 20,
      },
    });

    return listEventsResultSchema.parse(
      result.structuredContent,
    );
  }

  async createCalendarEvent(input: {
    connectionId: string;
    title: string;
    description?: string;
    start: string;
    end: string;
    approvalId: string;
    idempotencyKey: string;
  }) {
    const argumentsObject: Record<string, unknown> = {
      connectionId: input.connectionId,
      title: input.title,
      start: input.start,
      end: input.end,
      approvalId: input.approvalId,
      idempotencyKey: input.idempotencyKey,
    };

    if (input.description !== undefined) {
      argumentsObject.description = input.description;
    }

    const result = await this.callTool({
      name: "calendar.create_event",
      arguments: argumentsObject,
    });

    return createEventResultSchema.parse(
      result.structuredContent,
    );
  }
}