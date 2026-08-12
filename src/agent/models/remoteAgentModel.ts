import * as z from 'zod/v4';

import type {
  AgentModel,
  AgentModelExecution,
  AgentModelInput,
  AgentModelResult,
} from '../types';
import { AgentError } from '../types';

const REMOTE_AGENT_TIMEOUT_MS = 90_000;

/** Dev-only transport diagnostics. Never logs tokens or credentials. */
const DEV_LOG = typeof __DEV__ === 'boolean' && __DEV__;

const reasoningSchema = z.object({
  crossSourceSynthesis: z.boolean().optional(),
  conflictingEvidence: z.boolean().optional(),
  constraintSolving: z.boolean().optional(),
  temporalReconciliation: z.boolean().optional(),
  rankingOrOptimization: z.boolean().optional(),
  dependentMultiStageReasoning: z.boolean().optional(),
  unresolvedAmbiguity: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional(),
  needsDeeperReasoning: z.boolean().optional(),
});

const agentResultSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('final'),
      text: z.string(),
      reasoning: reasoningSchema.optional(),
    }),
    z.object({
      kind: z.literal('tool_calls'),
      text: z.string().nullish(),
      toolCalls: z.array(
        z.object({
          id: z.string(),
          toolName: z.string(),
          args: z.record(z.string(), z.unknown()),
        }),
      ),
      reasoning: reasoningSchema.optional(),
    }),
  ]);

const modelTierSchema = z.enum([
  'fast',
  'normal',
  'expert',
]);

const usageSchema = z.object({
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
});

const agentStepResponseSchema = z.object({
  requestedModelTier: modelTierSchema,
  effectiveModelTier: modelTierSchema,
  routingReason: z.string(),
  result: agentResultSchema,
  usage: usageSchema.nullish(),
});

interface RemoteAgentModelOptions {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null>;
}

export function createRemoteAgentModel(
  options: RemoteAgentModelOptions,
): AgentModel {
  let requestCounter = 0;

  return {
    id: 'remote-agent',

    capabilities: {
      textGeneration: true,
      toolCalling: true,
      structuredOutput: true,
    },

    async run(input: AgentModelInput): Promise<AgentModelResult> {
      requestCounter += 1;
      const requestId = `req_${requestCounter.toString(36)}_${Date.now().toString(36)}`;

      const endpoint = `${options.baseUrl}/agent/step`;
      if (DEV_LOG) {
        console.log('[chat] model=remote-agent');
        console.log(`[chat] endpoint=${endpoint}`);
      }

      const token = await options.getAccessToken?.();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const controller = new AbortController();
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, REMOTE_AGENT_TIMEOUT_MS);

      const cancelFromCaller = () => {
        controller.abort();
      };

      input.signal?.addEventListener(
        'abort',
        cancelFromCaller,
        { once: true },
      );

      try {
        if (DEV_LOG) console.log('[chat] POST /agent/step started');
        const response = await fetch(
          endpoint,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              requestId,
              runId: input.runId,
              routing: input.routing,
              messages: input.messages,
              tools: input.tools,
              connections: input.connections,
            }),
            signal: controller.signal,
          },
        );

        if (DEV_LOG) {
          console.log(`[chat] POST /agent/step status=${response.status}`);
        }

        if (!response.ok) {
          const body = await safeJson(response);
          const detail =
            typeof body?.message === 'string'
              ? body.message
              : response.statusText;

          switch (response.status) {
            case 401:
              throw new AgentError('AUTH_REQUIRED', detail);
            case 429:
              throw new AgentError('RATE_LIMITED', detail);
            case 422:
              throw new AgentError('MODEL_ERROR', detail);
            default:
              throw new AgentError(
                response.status >= 500
                  ? 'NETWORK_ERROR'
                  : 'MODEL_ERROR',
                `Remote agent failed with ${response.status}: ${detail}`,
              );
          }
        }

        let json: unknown;
        try {
          json = await response.json();
        } catch (error) {
          throw new AgentError(
            'MODEL_ERROR',
            'The server returned malformed JSON.',
            error,
          );
        }

        const parsed = agentStepResponseSchema.safeParse(json);

        if (!parsed.success) {
          throw new AgentError(
            'MODEL_ERROR',
            'The server returned an invalid agent response.',
            parsed.error,
          );
        }

        const data = parsed.data;

        const execution: AgentModelExecution = {
          requestedTier: data.requestedModelTier,
          effectiveTier: data.effectiveModelTier,
          routingReason: data.routingReason,
          usage: data.usage ?? undefined,
        };

        if (data.result.kind === 'final') {
          return {
            kind: 'final',
            text: data.result.text,
            reasoning: data.result.reasoning,
            execution,
          };
        }

        return {
          kind: 'tool_calls',
          text: data.result.text ?? undefined,
          toolCalls: data.result.toolCalls,
          reasoning: data.result.reasoning,
          execution,
        };
      } catch (error) {
        if (error instanceof AgentError) {
          throw error;
        }

        if (input.signal?.aborted) {
          throw new AgentError(
            'CANCELLED',
            'The request was cancelled',
            error,
          );
        }

        if (timedOut) {
          throw new AgentError(
            'NETWORK_ERROR',
            'The remote agent request timed out.',
            error,
          );
        }

        throw new AgentError(
          'NETWORK_ERROR',
          `Could not reach the server at ${options.baseUrl}`,
          error,
        );
      } finally {
        clearTimeout(timeout);
        input.signal?.removeEventListener(
          'abort',
          cancelFromCaller,
        );
      }
    },
  };
}

async function safeJson(
  response: Response,
): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
