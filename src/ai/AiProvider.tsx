import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ConnectionAdapter } from '@tanstack/ai-client';

import { createConnection, resolveEngine } from './index';
import { createStubEngine } from './engines/stubEngine';
import { engineConnection } from './engineConnection';
import { SYSTEM_PROMPT } from './config';
import type { EngineOrigin, LlmEngine } from './types';

type EngineStatus = 'preparing' | 'ready' | 'degraded';

interface AiContextValue {
  connection: ConnectionAdapter;
  origin: EngineOrigin;
  status: EngineStatus;
  /** Set when the preferred engine failed and a fallback took over. */
  degradedReason: string | null;
}

const AiContext = createContext<AiContextValue | null>(null);

/**
 * Owns engine lifecycle for the whole app.
 *
 * Weights are loaded once here rather than per-screen, and a failure to load
 * them degrades to the stub instead of leaving the user with a chat box that
 * silently never answers.
 */
export function AiProvider({ children }: { children: React.ReactNode }) {
  const initial = useMemo(() => {
    const descriptor = resolveEngine();
    return { descriptor, ...createConnection(descriptor) };
  }, []);

  const [connection, setConnection] = useState<ConnectionAdapter>(
    initial.connection,
  );
  const [origin, setOrigin] = useState<EngineOrigin>(initial.origin);
  // Seeded as 'preparing' rather than set inside the effect: preparation
  // starts on mount unconditionally, so that IS the initial state. Setting it
  // in the effect body would be a cascading render for no benefit.
  const [status, setStatus] = useState<EngineStatus>('preparing');
  const [degradedReason, setDegradedReason] = useState<string | null>(null);

  const engineRef = useRef<LlmEngine>(initial.descriptor.engine);

  useEffect(() => {
    let cancelled = false;
    const engine = engineRef.current;

    engine
      .prepare()
      .then(() => {
        if (!cancelled) setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // The preferred engine is unusable on this device/build. Rather than
        // surfacing a dead chat, fall back and say so.
        const fallback = createStubEngine();
        engineRef.current = fallback;
        setConnection(
          engineConnection(fallback, { systemPrompt: SYSTEM_PROMPT }),
        );
        setOrigin('stub');
        setDegradedReason(
          error instanceof Error ? error.message : 'Model failed to load',
        );
        setStatus('degraded');
        void fallback.prepare();
      });

    return () => {
      cancelled = true;
      void engineRef.current.dispose?.();
    };
  }, []);

  const value = useMemo<AiContextValue>(
    () => ({ connection, origin, status, degradedReason }),
    [connection, origin, status, degradedReason],
  );

  return <AiContext.Provider value={value}>{children}</AiContext.Provider>;
}

export function useAi(): AiContextValue {
  const value = useContext(AiContext);
  if (!value) throw new Error('useAi must be used inside <AiProvider>');
  return value;
}
