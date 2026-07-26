/**
 * AG-UI protocol event construction.
 *
 * TanStack AI's `StreamChunk` is an AG-UI event (`@ag-ui/core`). A custom
 * connection must emit a well-formed run so the client can assemble message
 * parts. The minimum viable text run is:
 *
 *   RUN_STARTED
 *     TEXT_MESSAGE_START
 *     TEXT_MESSAGE_CONTENT  (xN)
 *     TEXT_MESSAGE_END
 *   RUN_FINISHED
 *
 * A failed run must terminate with RUN_ERROR instead of RUN_FINISHED,
 * otherwise the client stays in a loading state forever.
 */
import { EventType } from '@ag-ui/core';
import type { StreamChunk } from '@tanstack/ai/client';

export interface RunIds {
  threadId: string;
  runId: string;
  messageId: string;
  model?: string;
}

export function runStarted({ threadId, runId, model }: RunIds): StreamChunk {
  return { type: EventType.RUN_STARTED, threadId, runId, model } as StreamChunk;
}

export function textStart({ messageId, model }: RunIds): StreamChunk {
  return {
    type: EventType.TEXT_MESSAGE_START,
    messageId,
    role: 'assistant',
    model,
  } as StreamChunk;
}

export function textDelta({ messageId }: RunIds, delta: string): StreamChunk {
  return {
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId,
    delta,
  } as StreamChunk;
}

export function textEnd({ messageId }: RunIds): StreamChunk {
  return { type: EventType.TEXT_MESSAGE_END, messageId } as StreamChunk;
}

export function runFinished({ threadId, runId, model }: RunIds): StreamChunk {
  return { type: EventType.RUN_FINISHED, threadId, runId, model } as StreamChunk;
}

export function runError(
  { threadId, runId }: RunIds,
  message: string,
  code?: string,
): StreamChunk {
  return {
    type: EventType.RUN_ERROR,
    threadId,
    runId,
    message,
    code,
  } as StreamChunk;
}
