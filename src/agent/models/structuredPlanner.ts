import * as z from 'zod/v4';

import type { EnginePrompt, LlmEngine } from '@/ai/types';
import type {
  AgentMessage,
  AgentModel,
  AgentModelInput,
  AgentModelResult,
  AgentToolDefinition,
} from '../types';

const plannerReasoningSchema = z
  .object({
    crossSourceSynthesis:
      z.boolean().optional(),

    conflictingEvidence:
      z.boolean().optional(),

    constraintSolving:
      z.boolean().optional(),

    temporalReconciliation:
      z.boolean().optional(),

    rankingOrOptimization:
      z.boolean().optional(),

    dependentMultiStageReasoning:
      z.boolean().optional(),

    unresolvedAmbiguity:
      z.boolean().optional(),

    confidence:
      z.number().min(0).max(1).optional(),

    needsDeeperReasoning:
      z.boolean().optional(),
  })
  .strict();
/**
 * Strict structured-planner protocol for local text models without native
 * function calling. The model must answer with exactly one JSON object; every
 * response is validated with Zod before anything reaches MCP. Arbitrary
 * prose is never parsed as a tool call — an unparseable answer degrades to
 * a final text reply, never to a guessed action.
 */
const plannerResponseSchema =
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('final'),
      content: z.string().min(1),

      reasoning:
        plannerReasoningSchema.optional(),
    }),

    z.object({
      type: z.literal('tool_call'),
      tool: z.string().min(1),

      arguments: z.record(
        z.string(),
        z.unknown(),
      ),

      reasoning:
        plannerReasoningSchema.optional(),
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
    /*
     * The product is named here on purpose. Without it the planner treated
     * "make this the digital assistant" as a question about themes and
     * personas, because it had no way to know it *was* the thing being
     * referred to.
     */
    'You are Creepy, the assistant inside the Creepy.IM app (package',
    'im.creepy.app) on the user\'s Android phone. You are the app the user is',
    'talking to right now, not a generic assistant inside someone else\'s',
    'product.',
    'When the user says "this", "this app", "you" or "Creepy" they mean this',
    'app. "Make this the digital assistant" means make Creepy the phone\'s',
    'assistant — it is not about a theme or a persona. Do not ask which',
    'product they mean.',
    'Reply with EXACTLY ONE JSON object. No markdown fences, no commentary.',
    'To call one tool: {"type":"tool_call","tool":"<name>","arguments":{...}}',
    'To answer the user: {"type":"final","content":"<text>"}',
    /*
     * The worked example is here because the abstract shape was not enough.
     * A local 2B twice produced `{"connectionId":"android-device", ...}` —
     * `connectionId` hoisted to the top level, the envelope lost — after
     * being told only to "always pass the connectionId", which says what to
     * send and not where it goes. Showing one filled-in object costs a few
     * tokens and removes the ambiguity.
     */
    'The object has exactly these top-level keys and no others. Example:',
    /*
     * The example carries a real connection id rather than a placeholder.
     * A model that copies the example verbatim then copies something that
     * works — and copying is what small models do. The observed failure was
     * `"connectionId":"android"`, the namespace every tool name starts with,
     * against an account actually called `android-device`.
     */
    `{"type":"tool_call","tool":"<name>","arguments":{"connectionId":"${
      input.connections[0]?.id ?? '<id from the list below>'
    }"}}`,
    'Rules:',
    '- Call one tool at a time, then wait for the tool result shown in the conversation.',
    '- Never invent tool names, connection ids or chat ids — use only values present in this prompt or in tool results.',
    '- connectionId is a tool argument: put it INSIDE "arguments", never at the top level.',
    '- Always pass the connectionId of a connected account from the list below.',
    '- "content" is plain text for the user to read. Never put JSON in it.',
    '- Actions with side effects (sending messages, creating events) require user approval; just call the tool, the app handles confirmation.',
    '- If the needed service is not connected, reply with {"type":"final"} saying so.',
    '- You may include an optional "reasoning" object describing the reasoning required for the current task.',
    '- Set reasoning flags to true only when they genuinely apply.',
    '- crossSourceSynthesis: information from multiple sources must be combined to reach one conclusion.',
    '- conflictingEvidence: sources or constraints conflict and must be reconciled.',
    '- constraintSolving: several requirements must all be satisfied together.',
    '- temporalReconciliation: dates, times, ordering, recency, or relative time require reconciliation.',
    '- rankingOrOptimization: several valid options must be ranked or optimized.',
    '- dependentMultiStageReasoning: later actions depend materially on interpreting earlier results.',
    '- unresolvedAmbiguity: important ambiguity remains and may require user clarification.',
    '- confidence is between 0 and 1.',
    '- needsDeeperReasoning is advisory only. Never choose or name a model tier.',
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
      case 'user': {
        const attachmentNote =
          message.attachments && message.attachments.length > 0
            ? ` [Attachments: ${message.attachments
                .map((a) => a.name)
                .join(', ')}]`
            : '';
        lines.push(`User: ${message.content}${attachmentNote}`);
        break;
      }
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

/**
 * The protocol's own vocabulary: the keys this planner asks the model to emit.
 *
 * Content carrying these is describing a tool call, not answering a user. No
 * ordinary reply says `"tool":` or `"connectionId":` — those are words this
 * file put in the model's mouth.
 */
const PROTOCOL_KEYS =
  /"(?:type|tool|arguments|connectionId|content)"\s*:/u;

/**
 * A `final` whose whole content is a protocol fragment is a failure, not an
 * answer.
 *
 * The schema only asks that `content` be a non-empty string, and a small model
 * asked to emit JSON will emit JSON there too. Twice now this reached a user
 * asking "Open Digital Assistant App setting and change it to Creepy":
 *
 *     {"connectionId":"android-device"}
 *
 *     {"connectionId":"android-device","arguments":{""assistant":{"type":
 *      "tool_call","tool":"android.assistant.request_role","connectionId":
 *      "android-device"}
 *
 * Both are the tool call the model meant to make, mangled and wrapped in a
 * `final` the parser accepted. `android.assistant.request_role` was available
 * throughout and was never called.
 *
 * The second one is why this cannot simply require valid JSON, which is what
 * the first version of this check did. Debris is *usually* malformed — being
 * malformed is often why the model ended up putting it in a string — so
 * `JSON.parse` throwing is evidence for a fragment, not against one. What
 * separates the two cases is vocabulary: valid JSON standing alone is treated
 * as a fragment, and malformed JSON only when it also names the protocol's own
 * keys.
 *
 * Text that merely quotes JSON is a legitimate answer — explaining a tool
 * result is exactly what the assistant should be able to do — so the check
 * still requires the content to be structural end to end.
 *
 * The residual cost is a user who genuinely asks for a bare JSON document
 * containing one of those key names. They get the retry, and then an honest
 * failure rather than a wrong answer.
 */
function isRawProtocolFragment(content: string): boolean {
  const trimmed = content.trim();
  const looksStructural =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'));
  if (!looksStructural) return false;

  try {
    const value: unknown = JSON.parse(trimmed);
    if (typeof value === 'object' && value !== null) return true;
  } catch {
    // Malformed. Decided by vocabulary below rather than dismissed.
  }

  return PROTOCOL_KEYS.test(trimmed);
}

/**
 * The tool names worth showing a model that just invented one.
 *
 * Not all of them. The failure this replaces pasted every registered tool into
 * the chat, and the same list in a correction prompt would be no better for a
 * 2B: the useful signal is which real names are close to the one it reached
 * for. `android.settings.get_app_info` is one edit-distance idea away from
 * `android.apps.get_info`, and seeing the two side by side is what makes the
 * second attempt land.
 *
 * Ranked by shared name parts — namespace first, then the words after it —
 * with anything from the same namespace preferred, since a model that got the
 * namespace right usually has the right area and the wrong verb.
 */
function nearestToolNames(
  invented: string,
  tools: readonly AgentToolDefinition[],
  limit = 8,
): string[] {
  const parts = new Set(invented.split(/[._]/u).filter(Boolean));
  const namespace = invented.split('.')[0] ?? '';

  return [...tools]
    .map((tool) => {
      const overlap = tool.name
        .split(/[._]/u)
        .filter((part: string) => parts.has(part)).length;
      const sameNamespace = tool.name.startsWith(`${namespace}.`) ? 1 : 0;
      return { name: tool.name, score: overlap + sameNamespace * 2 };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((entry) => entry.name);
}

function unknownToolHint(
  invented: string,
  tools: readonly AgentToolDefinition[],
): string {
  if (tools.length === 0) {
    return (
      `There is no tool named "${invented}", and no tools are available at ` +
      'all. Reply with {"type":"final","content":"<plain sentence saying you ' +
      'cannot do this>"}.'
    );
  }

  return (
    `There is no tool named "${invented}". Use one of these exact names, or ` +
    'say you cannot do it:\n' +
    nearestToolNames(invented, tools)
      .map((name) => `- ${name}`)
      .join('\n') +
    '\nReply with EXACTLY ONE JSON object: ' +
    '{"type":"tool_call","tool":"<exact name>","arguments":{...}} or ' +
    '{"type":"final","content":"<plain sentence for the user>"}.'
  );
}

function parsePlannerResponse(
  text: string,
): z.infer<typeof plannerResponseSchema> | null {
  const cleaned = text.replace(/```(?:json)?/gu, '');
  const candidate = extractJsonObject(cleaned);
  if (!candidate) return null;

  let parsed: z.infer<typeof plannerResponseSchema>;
  try {
    parsed = plannerResponseSchema.parse(JSON.parse(candidate));
  } catch {
    return null;
  }

  // Treated as unparseable, so the caller's correction retry gets a chance
  // and, failing that, the honest degradation message is what the user sees.
  if (parsed.type === 'final' && isRawProtocolFragment(parsed.content)) {
    return null;
  }

  return parsed;
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

      const PROTOCOL_HINT =
        'That was not valid protocol output. Reply with EXACTLY ONE ' +
        'JSON object having a top-level "type". Either\n' +
        '{"type":"tool_call","tool":"<one of the tool names above>",' +
        '"arguments":{"connectionId":"<id>", ...}}\n' +
        'or\n' +
        '{"type":"final","content":"<plain sentence for the user>"}\n' +
        'Do not put JSON inside "content". Do not put "connectionId" ' +
        'at the top level. No other text.';

      let completion = await generateOnce(basePrompts, input.signal);
      let parsed = parsePlannerResponse(completion);

      /*
       * An invented tool name is a protocol failure and gets the same retry as
       * malformed output, rather than ending the run.
       *
       * It used to return a `final`, so "Turn off Gemini app" was answered
       * with "I wanted to use a tool named android.settings.get_app_info, but
       * it is not available. Available tools: system.health,
       * calendar.list_events, …" — the whole registry pasted into a chat
       * bubble. That text was written for the model and handed to the user
       * instead, and the model, which could have picked the real
       * `android.apps.get_info` on a second look, never got one.
       */
      const requestedTool =
        parsed?.type === 'tool_call' ? parsed.tool : null;
      const unknownTool =
        requestedTool !== null &&
        !input.tools.some((tool) => tool.name === requestedTool)
          ? requestedTool
          : null;

      if ((!parsed || unknownTool) && !input.signal?.aborted) {
        // One strict retry with a correction hint; then give up gracefully.
        const retryPrompts: EnginePrompt[] = [
          ...basePrompts,
          {
            role: 'assistant',
            content: completion.slice(0, 500),
          },
          {
            role: 'user',
            /*
             * Concrete, because the generic version of this hint did not
             * recover a single one of the failures seen on device. The model
             * that lost the envelope needs to be shown the envelope, and the
             * model that invented a name needs the names that nearly match it
             * rather than all of them.
             */
            content: unknownTool
              ? unknownToolHint(unknownTool, input.tools)
              : PROTOCOL_HINT,
          },
        ];
        completion = await generateOnce(retryPrompts, input.signal);
        parsed = parsePlannerResponse(completion);
      }

      if (!parsed) {
        /*
         * Never fabricate a tool call from prose. Whatever readable text the
         * model produced becomes the answer; otherwise admit failure.
         *
         * "Readable" excludes protocol leftovers. A completion like
         * `Sure. {"connectionId":"android-device"}` has a real sentence and a
         * fragment of a tool call stuck to it, and only the sentence is for
         * the user. Nothing that parses reaches here, so trimming a trailing
         * JSON object can only remove debris.
         */
        const fallback = completion
          .trim()
          .replace(/\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*$/u, '')
          .trim();

        return {
          kind: 'final',
          text:
            fallback.length > 0
              ? fallback
              : 'I could not form a valid plan for that request. Please rephrase.',
        };
      }

      if (parsed.type === 'final') {
        return { kind: 'final', text: parsed.content, reasoning: parsed.reasoning };
      }

      const known = input.tools.some((tool) => tool.name === parsed.tool);
      if (!known) {
        /*
         * Still invented after the retry. What the user gets is a sentence
         * about their request, not a catalogue: the tool list is this file's
         * problem and means nothing to them.
         */
        return {
          kind: 'final',
          text:
            input.tools.length === 0
              ? 'I cannot do that yet — nothing is connected for me to act ' +
                'through. Connect an account in Settings and ask again.'
              : 'I do not have a way to do that on this device.',
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
        reasoning: parsed.reasoning,
      };
    },
  };
}
