import * as z from 'zod/v4';

import type {
  AgentModel,
  AgentModelExecution,
  AgentModelInput,
  AgentModelResult,
  AgentMessage,
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

/**
 * Server-readable attachment reference. Local `file://`/`content://` URIs and
 * raw binary are never serialized: only the stable backend id plus metadata.
 */
const remoteAttachmentSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  mimeType: z.string(),
  size: z.number(),
  kind: z.enum(['image', 'document', 'audio', 'video', 'other']),
});

type RemoteAttachment = z.infer<typeof remoteAttachmentSchema>;

/**
 * Serializes the transcript for `POST /agent/step`. User messages are reduced
 * to server-readable data: attachment `uri`/`remoteUrl` are dropped and only
 * the backend reference (`remoteId`) plus safe metadata survive. An
 * attachment without a backend id is excluded defensively — the upload gate
 * upstream makes this unreachable in practice.
 */
function serializeMessages(messages: AgentMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'user') {
      const attachments: RemoteAttachment[] = (message.attachments ?? [])
        .filter(
          (a) =>
            typeof a.remoteId === 'string' && a.remoteId.length > 0,
        )
        .map((a) => {
          const parsed = remoteAttachmentSchema.parse({
            id: a.remoteId,
            name: a.name,
            mimeType: a.mimeType,
            size: a.size,
            kind: a.kind,
          });
          return parsed;
        });

      return {
        id: message.id,
        role: 'user' as const,
        content: message.content,
        ...(attachments.length > 0 ? { attachments } : {}),
      };
    }

    if (message.role === 'assistant') {
      return {
        id: message.id,
        role: 'assistant' as const,
        content: message.content,
        ...(message.toolCalls && message.toolCalls.length > 0
          ? { toolCalls: message.toolCalls }
          : {}),
      };
    }

    return {
      id: message.id,
      role: 'tool' as const,
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      result: message.result,
    };
  });
}

interface RemoteAgentModelOptions {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null>;
  /**
   * Exchanges the refresh token for a fresh access token, or resolves null
   * when the session is genuinely over.
   *
   * Supplied rather than imported so this module keeps no dependency on the
   * api client, and so the caller can hand in the *same* single-flight
   * refresh the rest of the app uses. Two independent refreshes racing on
   * every expiry is the failure this avoids.
   */
  refreshAccessToken?: () => Promise<string | null>;
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
      fileInput: true,
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

      const body = JSON.stringify({
        requestId,
        runId: input.runId,
        routing: input.routing,
        messages: serializeMessages(input.messages),
        tools: input.tools,
        connections: input.connections,
      });

      const post = (bearer: string | null | undefined): Promise<Response> => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
        return fetch(endpoint, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });
      };

      try {
        if (DEV_LOG) console.log('[chat] POST /agent/step started');
        let response = await post(token);

        /*
         * The access token lives about fifteen minutes, so a conversation left
         * open past that expires mid-use. Without this the run failed with the
         * server's "Token is invalid or expired" while a perfectly good refresh
         * token sat in storage — the same defect the api client already fixed
         * for its own requests, reproduced here because this transport does not
         * go through it.
         *
         * One retry, and only when the refresh actually produced a token: a 401
         * from a request that carried no token, or after a refresh that failed,
         * is a real sign-out and must surface.
         */
        if (response.status === 401 && token && options.refreshAccessToken) {
          const refreshed = await options.refreshAccessToken();
          if (refreshed) {
            if (DEV_LOG) console.log('[chat] refreshed token, retrying');
            response = await post(refreshed);
          }
        }

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
              /*
               * Reaching here means the refresh above did not help, so the
               * session is genuinely over. The server's own wording — "Token
               * is invalid or expired" — describes a JWT, not anything the
               * user did or can act on, so it is replaced. `detail` is still
               * attached as the cause for logs.
               */
              throw new AgentError(
                'AUTH_REQUIRED',
                'Your session has ended. Sign in again to keep chatting.',
                new Error(detail),
              );
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
