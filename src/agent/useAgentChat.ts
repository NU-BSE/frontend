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

export interface AgentChat {
  /** 'agent' runs the tool loop; 'text-only' is the honest remote fallback. */
  mode: 'agent' | 'text-only';
  messages: readonly AgentMessage[];
  runState: AgentRunState;
  pendingApproval: PendingApproval | null;
  isRunning: boolean;
  sendMessage(text: string): void;
  approvePendingApproval(): void;
  rejectPendingApproval(): void;
  cancel(): void;
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

  // Text-only fallback path (remote engine without a tool contract).
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
  // a memo; the effect below only handles teardown.
  const agentRuntime = useMemo<AgentRuntime | null>(() => {
    if (!model || !mcpRuntime) return null;

    return new AgentRuntime({
      model,
      mcp: mcpRuntime.mcp,
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
  }, [category, mcpRuntime, model, queryClient]);

  useEffect(() => {
    return () => {
      agentRuntime?.cancel();
    };
  }, [agentRuntime]);

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
      if (!agentRuntime || agentRuntime.isRunning()) return;
      setIsRunning(true);
      void agentRuntime
        .sendMessage(text, threadId)
        .finally(() => setIsRunning(false));
    },
    [agentRuntime, threadId],
  );

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
      messages: textMessages,
      runState: textChat.isLoading ? { type: 'thinking' } : { type: 'idle' },
      pendingApproval: null,
      isRunning: textChat.isLoading,
      sendMessage: (text) => void textChat.sendMessage(text),
      approvePendingApproval: () => undefined,
      rejectPendingApproval: () => undefined,
      cancel: () => textChat.stop(),
      modelId,
    };
  }

  return {
    mode: 'agent',
    messages,
    runState,
    pendingApproval,
    isRunning,
    sendMessage: sendAgentMessage,
    approvePendingApproval: approve,
    rejectPendingApproval: reject,
    cancel: cancelAgent,
    modelId,
  };
}
