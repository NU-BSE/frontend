import { useChat } from '@tanstack/ai-react';

import { useAi } from './AiProvider';

/**
 * The single chat entry point for screens.
 *
 * Screens never construct a connection or know which engine is running —
 * they call this. That indirection is what makes "on-device today, hosted
 * tomorrow" a provider-level change rather than a UI rewrite.
 */
export function useCreepyChat(options?: { threadId?: string }) {
  const { connection, origin, status, degradedReason } = useAi();

  const chat = useChat({
    connection,
    threadId: options?.threadId,
  });

  return {
    ...chat,
    /** Where inference is happening — surfaced in the UI as a privacy signal. */
    engineOrigin: origin,
    engineStatus: status,
    degradedReason,
  };
}
