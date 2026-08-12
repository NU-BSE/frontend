import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { messageText } from '@/features/chat/MessageBubble';
import { approveConnectorTool, getLocalMcpRuntime } from '@/mcp/runtime-singleton';
import { useConnections } from '@/connections/useConnections';
import { appendHistory } from '@/storage/history';
import { useCreepyChat } from '@/ai/useCreepyChat';

import { AgentRuntime } from './AgentRuntime';
import { toConnectionSummaries } from './capabilityContext';
import { useAgentContext } from './AgentProvider';
import { AgentError } from './types';
import type {
  AgentMessage,
  AgentRunState,
  PendingApproval,
} from './types';

import { MCP_RUNTIME_QUERY_KEY } from '@/mcp/queryKeys';

export interface UseAgentChatOptions {
  threadId?: string;
  category?: string;
}

export type AgentReadiness = 'initializing' | 'ready' | 'running' | 'failed';

export interface AgentChat {
  /** 'agent' runs the tool loop via AgentRuntime; 'text-only' degrades when no model is available. */
  mode: 'agent' | 'text-only';
  /**
   * Whether the agent runtime can accept a message. 'initializing' means the
   * engine/model is still starting (text-only fallback may still work).
   */
  readiness: AgentReadiness;
  messages: readonly AgentMessage[];
  runState: AgentRunState;
  pendingApproval: PendingApproval | null;
  isRunning: boolean;
  /** Non-null when the local MCP runtime failed to initialize. Chat still works degraded. */
  mcpError: string | null;
  sendMessage(text: string): void;
  approvePendingApproval(): void;
  rejectPendingApproval(): void;
  cancel(): void;
  /** Re-runs runtime initialization after a failure. */
  retryInitialization(): void;
  modelId: string;
}

const EMPTY_MESSAGES: readonly AgentMessage[] = [];
const NOOP_UNSUBSCRIBE = () => {};

/**
 * The single agent-facing hook for screens. Owns conversation messages,
 * available MCP tools, LLM requests, tool calls and results, approval
 * interruptions, cancellation, max-step protection and errors — screens
 * never call MCP directly.
 */
export function useAgentChat(options: UseAgentChatOptions = {}): AgentChat {
  const { model, modelId } = useAgentContext();
  const queryClient = useQueryClient();

  // Text-only degrades when no AgentModel is available (local engine not ready).
  const textChat = useCreepyChat({ threadId: options.threadId });

  const runtimeQuery = useQuery({
    queryKey: MCP_RUNTIME_QUERY_KEY,
    queryFn: () => getLocalMcpRuntime(),
    staleTime: Infinity,
  });

  const connectionsQuery = useConnections();

  const [runState, setRunState] = useState<AgentRunState>({ type: 'idle' });
  const [pendingApproval, setPendingApproval] =
    useState<PendingApproval | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const mcpRuntime = runtimeQuery.data;
  const threadId = options.threadId ?? 'general';
  const category = options.category ?? 'General';

  // The runtime constructor is side-effect-free, so it is safe to build in
  // a memo; the effect below only handles teardown. MCP is injected later via
  // `setMcp` so a slow/failed MCP bootstrap never blocks plain remote chat.
  const agentRuntime = useMemo<AgentRuntime | null>(() => {
    if (!model) return null;

    return new AgentRuntime({
      model,
      connections: toConnectionSummaries(connectionsQuery.data ?? []),
      approveApproval: approveConnectorTool,
      onState: (state) => {
        setRunState(state);
        setPendingApproval(
          state.type === 'awaiting_approval' ? state.approval : null,
        );
      },
      onRoutingTelemetry: (
        telemetry,
      ) => {
        if (__DEV__) {
          console.log(
            '[agent-routing]',
            telemetry,
          );
        }
      },
      onRunRecord: (record) => {
        void appendHistory({
          threadId: record.threadId,
          category,
          prompt: record.userMessage,
          reply: record.finalAnswer ?? '',
          engine: record.engine,
          steps: record.steps,
        }).then(() =>
          queryClient.invalidateQueries({ queryKey: ['history'] }),
        );
      },
    });
    // connectionsQuery.data is intentionally not a dependency: live updates
    // flow through setConnections below, without rebuilding the conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, model, queryClient]);

  useEffect(() => {
    return () => {
      agentRuntime?.cancel();
    };
  }, [agentRuntime]);

  useEffect(() => {
    agentRuntime?.setMcp(mcpRuntime?.mcp);
  }, [agentRuntime, mcpRuntime]);

  const summaries = useMemo(
    () => toConnectionSummaries(connectionsQuery.data ?? []),
    [connectionsQuery.data],
  );

  useEffect(() => {
    agentRuntime?.setConnections(summaries);
  }, [agentRuntime, summaries]);

  const subscribeToMessages = useCallback(
    (onChange: () => void) =>
      agentRuntime
        ? agentRuntime.subscribeToMessages(onChange)
        : NOOP_UNSUBSCRIBE,
    [agentRuntime],
  );

  const getMessagesSnapshot = useCallback(
    () => agentRuntime?.getMessages() ?? EMPTY_MESSAGES,
    [agentRuntime],
  );

  const messages = useSyncExternalStore(
    subscribeToMessages,
    getMessagesSnapshot,
  );

  const sendAgentMessage = useCallback(
    (text: string) => {
      if (!agentRuntime) {
        // Defensive: the agent branch is only rendered when a model exists,
        // which guarantees a runtime. If it is somehow absent, surface an
        // explicit failure instead of dropping the message silently.
        setRunState({
          type: 'failed',
          error: new AgentError(
            'MODEL_ERROR',
            'Chat is not ready yet. Please try again.',
          ),
        });
        return;
      }
      if (agentRuntime.isRunning()) return;
      setIsRunning(true);
      void agentRuntime
        .sendMessage(text, threadId)
        .finally(() => setIsRunning(false));
    },
    [agentRuntime, threadId],
  );

  const retryInitialization = useCallback(() => {
    void runtimeQuery.refetch();
  }, [runtimeQuery]);

  const approve = useCallback(() => {
    void agentRuntime?.approvePendingApproval();
  }, [agentRuntime]);

  const reject = useCallback(() => {
    void agentRuntime?.rejectPendingApproval();
  }, [agentRuntime]);

  const cancelAgent = useCallback(() => {
    agentRuntime?.cancel();
    setIsRunning(false);
  }, [agentRuntime]);

  // ---- text-only fallback mapping -------------------------------------

  const textMessages = useMemo<readonly AgentMessage[]>(
    () =>
      textChat.messages.flatMap((message): AgentMessage[] => {
        const content = messageText(message);
        if (!content) return [];
        if (message.role === 'user') {
          return [{ id: message.id, role: 'user', content }];
        }
        return [{ id: message.id, role: 'assistant', content }];
      }),
    [textChat.messages],
  );

  if (!model) {
    return {
      mode: 'text-only',
      readiness: 'initializing',
      messages: textMessages,
      runState: textChat.isLoading ? { type: 'thinking' } : { type: 'idle' },
      pendingApproval: null,
      isRunning: textChat.isLoading,
      mcpError: null,
      sendMessage: (text) => void textChat.sendMessage(text),
      approvePendingApproval: () => undefined,
      rejectPendingApproval: () => undefined,
      cancel: () => textChat.stop(),
      retryInitialization,
      modelId,
    };
  }

  const mcpError = runtimeQuery.isError
    ? (runtimeQuery.error instanceof Error
        ? runtimeQuery.error.message
        : 'Local MCP runtime failed to initialize.')
    : null;

  const readiness: AgentReadiness = isRunning
    ? 'running'
    : runState.type === 'failed'
      ? 'failed'
      : 'ready';

  return {
    mode: 'agent',
    readiness,
    messages,
    runState,
    pendingApproval,
    isRunning,
    mcpError,
    sendMessage: sendAgentMessage,
    approvePendingApproval: approve,
    rejectPendingApproval: reject,
    cancel: cancelAgent,
    retryInitialization,
    modelId,
  };
}
