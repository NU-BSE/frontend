/**
 * Bridges an `LlmEngine` to TanStack AI's ConnectionAdapter contract.
 *
 * `stream()` from @tanstack/ai-client accepts any factory returning an
 * `AsyncIterable<StreamChunk>`, which is the documented seam for non-HTTP
 * transports (server functions, RPC — and here, in-process inference).
 * Nothing about this file assumes a network exists.
 */
import { stream } from '@tanstack/ai-client';
import type { ConnectionAdapter } from '@tanstack/ai-client';
import type { ModelMessage, StreamChunk, UIMessage } from '@tanstack/ai/client';

import {
  runError,
  runFinished,
  runStarted,
  textDelta,
  textEnd,
  textStart,
  type RunIds,
} from './chunks';
import type { EnginePrompt, LlmEngine } from './types';

let counter = 0;
/** Monotonic, collision-free within a session. Avoids a uuid dependency. */
function localId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

function isUIMessage(m: UIMessage | ModelMessage): m is UIMessage {
  return Array.isArray((m as UIMessage).parts);
}

/**
 * Flattens either message representation to plain text turns.
 *
 * UIMessages carry a `parts` array (text, tool-call, tool-result, thinking);
 * only text parts are meaningful to a text-completion engine. Tool parts are
 * dropped rather than stringified so the model never sees protocol noise.
 */
export function toEnginePrompts(
  messages: UIMessage[] | ModelMessage[],
): EnginePrompt[] {
  const out: EnginePrompt[] = [];

  for (const message of messages) {
    if (isUIMessage(message)) {
      const text = message.parts
        .filter((part): part is Extract<typeof part, { type: 'text' }> =>
          part.type === 'text')
        .map((part) => part.content)
        .join('')
        .trim();
      if (text) out.push({ role: message.role, content: text });
      continue;
    }

    // ModelMessage: `tool` role has no analogue in a plain-text prompt.
    if (message.role === 'tool') continue;

    const { content } = message;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter((part): part is Extract<typeof part, { type: 'text' }> =>
                part?.type === 'text')
              .map((part) => part.content ?? '')
              .join('')
          : '';
    const trimmed = text.trim();
    if (trimmed) out.push({ role: message.role, content: trimmed });
  }

  return out;
}

export interface EngineConnectionOptions {
  /** Prepended to every run. Kept here so screens don't own prompt policy. */
  systemPrompt?: string;
  /** Notified on failure so the UI can offer a fallback engine. */
  onError?: (error: unknown) => void;
}

/**
 * Produce a ConnectionAdapter that runs `engine` locally and emits a
 * protocol-correct AG-UI event stream.
 */
export function engineConnection(
  engine: LlmEngine,
  options: EngineConnectionOptions = {},
): ConnectionAdapter {
  const { systemPrompt, onError } = options;

  return stream(async function* generateRun(
    messages,
    data,
    abortSignal,
  ): AsyncIterable<StreamChunk> {
    const ids: RunIds = {
      // The client stamps its own run/thread ids onto chunks that omit them,
      // so locally-generated ids here are only a fallback for direct use.
      threadId: (data?.threadId as string) ?? localId('thread'),
      runId: (data?.runId as string) ?? localId('run'),
      messageId: localId('msg'),
      model: engine.id,
    };

    yield runStarted(ids);

    let textOpen = false;
    try {
      if (!engine.isReady()) await engine.prepare();
      if (abortSignal?.aborted) {
        // Nothing was generated; close the run cleanly rather than erroring.
        yield runFinished(ids);
        return;
      }

      const prompts = toEnginePrompts(messages);
      if (systemPrompt) {
        prompts.unshift({ role: 'system', content: systemPrompt });
      }

      yield textStart(ids);
      textOpen = true;

      for await (const delta of engine.generate(prompts, {
        signal: abortSignal,
        data,
      })) {
        if (abortSignal?.aborted) break;
        if (delta) yield textDelta(ids, delta);
      }

      yield textEnd(ids);
      textOpen = false;
      yield runFinished(ids);
    } catch (error) {
      // An open TEXT_MESSAGE must be closed before RUN_ERROR, or the client
      // is left holding an unterminated message part.
      if (textOpen) yield textEnd(ids);
      onError?.(error);
      yield runError(
        ids,
        error instanceof Error ? error.message : 'Generation failed',
        'ENGINE_ERROR',
      );
    }
  });
}
