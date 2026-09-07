import React, { createContext, useContext, useMemo } from 'react';

import { useAi } from '@/ai/AiProvider';
import type { LlmCapabilities } from '@/ai/types';
import { baseUrl, getToken, refreshAccessTokenOnce } from '@/api/client';
import { useLocalDeviceConnectionSync } from '@/connections/android/useLocalDeviceConnectionSync';
import { useEntitlementEnforcement } from '@/features/subscription/useEntitlementEnforcement';
import { createDeterministicPlanner } from './models/deterministicPlanner';
import { createStructuredPlanner } from './models/structuredPlanner';
import { createRemoteAgentModel } from './models/remoteAgentModel';
import type { AgentModel } from './types';

interface AgentContextValue {
  /**
   * The planning model for the current engine. Null only when there is no
   * in-process engine and no remote backend — the chat then degrades to an
   * honest text-only mode instead of faking tool use.
   */
  model: AgentModel | null;
  modelId: string;
  capabilities: LlmCapabilities;
}

const AgentContext = createContext<AgentContextValue | null>(null);

const TEXT_ONLY_CAPABILITIES: LlmCapabilities = {
  textGeneration: true,
  toolCalling: false,
  structuredOutput: false,
};

/**
 * Chooses the agent-facing model for the active engine:
 *
 * - remote → tool-capable remote agent (POST /agent/step on the backend,
 *   endpoint derived from EXPO_PUBLIC_API_URL);
 * - offline-preview stub → deterministic planner, so the full loop
 *   (plan → MCP → approval → execute → confirm) stays demoable;
 * - on-device text engine → strict structured planner (JSON protocol, every
 *   response Zod-validated before MCP).
 */
export function AgentProvider({ children }: { children: React.ReactNode }) {
  // Permissions granted on a system screen must take effect on return, and
  // the return usually lands back in chat rather than on the settings screen.
  useLocalDeviceConnectionSync();
  // Mounted here rather than on the connectors screen: a subscription lapses
  // while the app is anywhere, and the accounts have to go with it.
  useEntitlementEnforcement();

  const { engine, origin } = useAi();

  const value = useMemo<AgentContextValue>(() => {
    if (origin === 'remote') {
      if (typeof __DEV__ === 'boolean' && __DEV__) {
        console.log('[chat] mode=agent origin=remote');
      }
      const model = createRemoteAgentModel({
        baseUrl: baseUrl(),
        getAccessToken: () => getToken(),
        refreshAccessToken: () => refreshAccessTokenOnce(),
      });

      return {
        model,
        modelId: model.id,
        capabilities: model.capabilities,
      };
    }

    if (!engine) {
      return {
        model: null,
        modelId: 'none',
        capabilities: TEXT_ONLY_CAPABILITIES,
      };
    }

    const model =
      engine.id === 'creepyim-stub'
        ? createDeterministicPlanner()
        : createStructuredPlanner(engine);

    return {
      model,
      modelId: model.id,
      capabilities: model.capabilities,
    };
  }, [engine, origin]);

  return (
    <AgentContext.Provider value={value}>{children}</AgentContext.Provider>
  );
}

export function useAgentContext(): AgentContextValue {
  const value = useContext(AgentContext);
  if (!value) throw new Error('useAgentContext must be used inside <AgentProvider>');
  return value;
}
