import React, { createContext, useContext, useMemo } from 'react';

import { useAi } from '@/ai/AiProvider';
import type { LlmCapabilities } from '@/ai/types';
import { createDeterministicPlanner } from './models/deterministicPlanner';
import { createStructuredPlanner } from './models/structuredPlanner';
import type { AgentModel } from './types';

interface AgentContextValue {
  /**
   * The planning model for the current engine. Null only when generation is
   * remote (no tool-calling contract with the backend yet) — the chat then
   * degrades to honest text-only mode instead of faking tool use.
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
 * - on-device text engine → strict structured planner (JSON protocol, every
 *   response Zod-validated before MCP);
 * - offline-preview stub → deterministic planner, so the full loop
 *   (plan → MCP → approval → execute → confirm) stays demoable;
 * - remote → null (text-only) until the backend exposes a tool contract.
 */
export function AgentProvider({ children }: { children: React.ReactNode }) {
  const { engine, origin } = useAi();

  const value = useMemo<AgentContextValue>(() => {
    if (origin === 'remote' || !engine) {
      return {
        model: null,
        modelId: origin === 'remote' ? 'remote-text' : 'none',
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
