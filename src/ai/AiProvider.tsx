import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ConnectionAdapter } from '@tanstack/ai-client';

import type { DeviceAssessment } from '@/attestation/client/deviceAssessment';
import {
  getDeviceAssessment,
  getMemoryProfile,
  hasCompletedOnboarding,
  type MemoryProfile,
} from '@/storage/prefs';
import { createConnection, resolveEngine } from './index';
import { createStubEngine } from './engines/stubEngine';
import { engineConnection } from './engineConnection';
import { SYSTEM_PROMPT } from './config';
import type { EngineOrigin, LlmEngine } from './types';

type EngineStatus = 'idle' | 'preparing' | 'ready' | 'degraded';

interface AiContextValue {
  connection: ConnectionAdapter;
  origin: EngineOrigin;
  status: EngineStatus;
  /** Set when the preferred engine failed and a fallback took over. */
  degradedReason: string | null;
  /**
   * The current in-process engine, or null when generation happens remotely
   * (the agent layer then cannot use it for tool planning).
   */
  engine: LlmEngine | null;
  /** Starts the selected engine only after device assessment and user choice. */
  activateSelectedEngine(
    profile: MemoryProfile,
    assessment: DeviceAssessment | null,
  ): Promise<void>;
  deactivateEngine(): Promise<void>;
}

const AiContext = createContext<AiContextValue | null>(null);

export function AiProvider({ children }: { children: React.ReactNode }) {
  const initial = useMemo(() => {
    const engine = createStubEngine();
    return {
      engine,
      connection: engineConnection(engine, { systemPrompt: SYSTEM_PROMPT }),
    };
  }, []);

  const [connection, setConnection] = useState<ConnectionAdapter>(
    initial.connection,
  );
  const [origin, setOrigin] = useState<EngineOrigin>('stub');
  const [status, setStatus] = useState<EngineStatus>('idle');
  const [degradedReason, setDegradedReason] = useState<string | null>(null);

  const engineRef = useRef<LlmEngine>(initial.engine);
  const activationRef = useRef(0);
  // Render-facing mirror of engineRef: refs must not be read during render.
  const [engineValue, setEngineValue] = useState<LlmEngine>(initial.engine);

  const activateSelectedEngine = useCallback(
    async (
      profile: MemoryProfile,
      assessment: DeviceAssessment | null,
    ): Promise<void> => {
      const activation = activationRef.current + 1;
      activationRef.current = activation;
      const selection = { memoryProfile: profile, assessment };
      const descriptor = resolveEngine(selection);
      const nextConnection = createConnection(descriptor);
      const previous = engineRef.current;

      engineRef.current = descriptor.engine;
      setEngineValue(descriptor.engine);
      setConnection(nextConnection.connection);
      setOrigin(nextConnection.origin);
      setDegradedReason(descriptor.degradedReason ?? null);

      try {
        await previous.dispose?.();
      } catch {
        // The replacement engine can still start if disposal fails.
      }
      if (activation !== activationRef.current) return;

      if (nextConnection.origin === 'remote') {
        setStatus('ready');
        return;
      }

      setStatus('preparing');
      try {
        await descriptor.engine.prepare();
        if (activation !== activationRef.current) return;
        setStatus(descriptor.degradedReason ? 'degraded' : 'ready');
      } catch (error: unknown) {
        if (activation !== activationRef.current) return;
        const fallback = createStubEngine();
        engineRef.current = fallback;
        setEngineValue(fallback);
        setConnection(
          engineConnection(fallback, { systemPrompt: SYSTEM_PROMPT }),
        );
        setOrigin('stub');
        setDegradedReason(
          error instanceof Error ? error.message : 'Model failed to load',
        );
        setStatus('degraded');
        await fallback.prepare();
      }
    },
    [],
  );

  const deactivateEngine = useCallback(async (): Promise<void> => {
    activationRef.current += 1;
    const previous = engineRef.current;
    const idle = createStubEngine();
    engineRef.current = idle;
    setEngineValue(idle);
    try {
      await previous.dispose?.();
    } catch {
      // Disposal is best-effort; the new idle connection must still replace it.
    }
    setConnection(engineConnection(idle, { systemPrompt: SYSTEM_PROMPT }));
    setOrigin('stub');
    setStatus('idle');
    setDegradedReason(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      hasCompletedOnboarding(),
      getMemoryProfile(),
      getDeviceAssessment(),
    ]).then(([completed, profile, assessment]) => {
      if (!cancelled && completed) {
        void activateSelectedEngine(profile, assessment);
      }
    });

    return () => {
      cancelled = true;
      activationRef.current += 1;
      void engineRef.current.dispose?.();
    };
  }, [activateSelectedEngine]);

  const value = useMemo<AiContextValue>(
    () => ({
      connection,
      origin,
      status,
      degradedReason,
      // Remote generation has no in-process engine the agent can plan with.
      engine: origin === 'remote' ? null : engineValue,
      activateSelectedEngine,
      deactivateEngine,
    }),
    [
      activateSelectedEngine,
      connection,
      deactivateEngine,
      degradedReason,
      engineValue,
      origin,
      status,
    ],
  );

  return <AiContext.Provider value={value}>{children}</AiContext.Provider>;
}

export function useAi(): AiContextValue {
  const value = useContext(AiContext);
  if (!value) throw new Error('useAi must be used inside <AiProvider>');
  return value;
}
