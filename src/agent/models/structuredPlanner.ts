import * as z from 'zod/v4';

import type { EnginePrompt, LlmEngine } from '@/ai/types';
import type {
  AgentMessage,
  AgentModel,
  AgentModelInput,
  AgentModelResult,
} from '../types';

/**
 * Strict structured-planner protocol for local text models without native
 * function calling. The model must answer with exactly one JSON object; every
 * response is validated with Zod before anything reaches MCP. Arbitrary
 * prose is never parsed as a tool call — an unparseable answer degrades to
 * a final text reply, never to a guessed action.
 */
const plannerResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('final'),
    content: z.string().min(1),
  }),
  z.object({
    type: z.literal('tool_call'),
    tool: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()),
  }),
]);

const MAX_TOOL_RESULT_CHARS = 2000;

function protocolInstructions(input: AgentModelInput): string {
  const toolLines = input.tools.map((tool) => {
    const properties =
      (tool.inputSchema.properties as Record<string, unknown> | undefined) ??
      {};
    const args = Object.keys(properties)
      .map((name) => {
        const property = properties[name] as {
          description?: string;
          type?: string;
        };
        return `${name}: ${property?.type ?? 'value'}${
          property?.description ? ` — ${property.description}` : ''
        }`;
      })
      .join('; ');
    return `- ${tool.name}: ${tool.description} Arguments: { ${args} }`;
  });

  const connectionLines =
    input.connections.length > 0
      ? input.connections
          .map(
            (connection) =>
              `- id: ${connection.id} (${connection.provider}, ` +
              `${connection.displayName}) capabilities: ` +
              connection.capabilities.join(', '),
          )
          .join('\n')
      : '- none — no external service is connected';

  return [
    'You are the action planner of a mobile assistant.',
    'Reply with EXACTLY ONE JSON object. No markdown fences, no commentary.',
    'To call one tool: {"type":"tool_call","tool":"<name>","arguments":{...}}',
    'To answer the user: {"type":"final","content":"<text>"}',
    'Rules:',
    '- Call one tool at a time, then wait for the tool result shown in the conversation.',
    '- Never invent tool names, connection ids or chat ids — use only values present in this prompt or in tool results.',
    '- Always pass the connectionId of a connected account from the list below.',
    '- Actions with side effects (sending messages, creating events) require user approval; just call the tool, the app handles confirmation.',
    '- If the needed service is not connected, reply with {"type":"final"} saying so.',
    '',
    'Available tools:',
    ...toolLines,
    '',
    'Connected accounts:',
    connectionLines,
  ].join('\n');
}

function serializeTranscript(messages: readonly AgentMessage[]): string {
  const lines: string[] = [];

  for (const message of messages) {
    switch (message.role) {
      case 'user':
        lines.push(`User: ${message.content}`);
        break;
      case 'assistant': {
        if (message.content) lines.push(`Assistant: ${message.content}`);
        for (const call of message.toolCalls ?? []) {
          lines.push(
            `Assistant requested tool call: ${JSON.stringify({
              tool: call.toolName,
              arguments: call.args,
            })}`,
          );
        }
        break;
      }
      case 'tool': {
        const payload = JSON.stringify(message.result);
        lines.push(
          `Tool result for ${message.toolName}: ` +
            (payload.length > MAX_TOOL_RESULT_CHARS
              ? `${payload.slice(0, MAX_TOOL_RESULT_CHARS)}…`
              : payload),
        );
        break;
      }
    }
  }

  return lines.join('\n');
}

/** Finds the first balanced top-level JSON object in the completion. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

function parsePlannerResponse(
  text: string,
): z.infer<typeof plannerResponseSchema> | null {
  const cleaned = text.replace(/```(?:json)?/gu, '');
  const candidate = extractJsonObject(cleaned);
  if (!candidate) return null;

  try {
    return plannerResponseSchema.parse(JSON.parse(candidate));
  } catch {
    return null;
  }
}

export function createStructuredPlanner(engine: LlmEngine): AgentModel {
  let callCounter = 0;

  async function generateOnce(
    prompts: EnginePrompt[],
    signal?: AbortSignal,
  ): Promise<string> {
    if (!engine.isReady()) await engine.prepare();

    let completion = '';
    for await (const delta of engine.generate(prompts, { signal })) {
      if (signal?.aborted) break;
      completion += delta;
    }
    return completion;
  }

  return {
    id: `structured-planner(${engine.id})`,
    capabilities: {
      textGeneration: true,
      toolCalling: true,
      structuredOutput: true,
    },

    async run(input: AgentModelInput): Promise<AgentModelResult> {
      const basePrompts: EnginePrompt[] = [
        { role: 'system', content: protocolInstructions(input) },
        {
          role: 'user',
          content: `${serializeTranscript(input.messages)}\n\nReply with exactly one JSON object now.`,
        },
      ];

      let completion = await generateOnce(basePrompts, input.signal);
      let parsed = parsePlannerResponse(completion);

      if (!parsed && !input.signal?.aborted) {
        // One strict retry with a correction hint; then give up gracefully.
        const retryPrompts: EnginePrompt[] = [
          ...basePrompts,
          {
            role: 'assistant',
            content: completion.slice(0, 500),
          },
          {
            role: 'user',
            content:
              'That was not valid protocol output. Reply with EXACTLY ONE ' +
              'JSON object: {"type":"tool_call","tool":...,"arguments":{...}} ' +
              'or {"type":"final","content":"..."}.',
          },
        ];
        completion = await generateOnce(retryPrompts, input.signal);
        parsed = parsePlannerResponse(completion);
      }

      if (!parsed) {
        // Never fabricate a tool call from prose. The raw completion (if any
        // readable text exists) becomes the answer; otherwise admit failure.
        const fallback = completion.trim();
        return {
          kind: 'final',
          text:
            fallback.length > 0 && !fallback.startsWith('{')
              ? fallback
              : 'I could not form a valid plan for that request. Please rephrase.',
        };
      }

      if (parsed.type === 'final') {
        return { kind: 'final', text: parsed.content };
      }

      const known = input.tools.some((tool) => tool.name === parsed.tool);
      if (!known) {
        return {
          kind: 'final',
          text: `I wanted to use a tool named "${parsed.tool}", but it is not available. ${
            input.tools.length === 0
              ? 'No external services are connected right now.'
              : 'Available tools: ' +
                input.tools.map((tool) => tool.name).join(', ') +
                '.'
          }`,
        };
      }

      callCounter += 1;
      return {
        kind: 'tool_calls',
        toolCalls: [
          {
            id: `call_sp_${callCounter.toString(36)}`,
            toolName: parsed.tool,
            args: parsed.arguments,
          },
        ],
      };
    },
  };
}
