import * as z from 'zod/v4';

import type {
  AgentModel,
  AgentModelInput,
  AgentModelResult,
} from '../types';
import { AgentError } from '../types';

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
      text: z.string().optional(),
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

const agentStepResponseSchema = z.object({
  result: agentResultSchema,
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

      const token = await options.getAccessToken?.();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      let response: Response;
      try {
        response = await fetch(
          `${options.baseUrl}/agent/step`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              requestId,
              routing: input.routing,
              messages: input.messages,
              tools: input.tools,
              connections: input.connections,
            }),
            signal: input.signal,
          },
        );
      } catch (error) {
        if (input.signal?.aborted) {
          throw new AgentError(
            'CANCELLED',
            'The request was cancelled',
          );
        }
        throw new AgentError(
          'NETWORK_ERROR',
          `Could not reach the server at ${options.baseUrl}`,
          error,
        );
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

      const json = await response.json();
      const parsed = agentStepResponseSchema.parse(json);

      return parsed.result as AgentModelResult;
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
