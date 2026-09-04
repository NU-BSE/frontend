/**
 * Bringing one translated MCP server up, and handing back a client for it.
 *
 * The sequence is fixed by what each step guarantees:
 *
 *   1. the bundle is fetched and its digest checked — executable code is not
 *      evaluated on the strength of a filename;
 *   2. the values the user supplied are read from the credential vault;
 *   3. the sandbox is mounted and evaluates the bundle;
 *   4. the server connects its transport, and only then is a client attached.
 *
 * Step 4 is why this is a state machine rather than a promise. The server
 * decides when it is ready — that is what the `ready` message means — and a
 * client that sent `initialize` before then would be talking to nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Client } from '@modelcontextprotocol/client';
import { AgentMcpClient } from '@mobile-agent/mcp-client';

import { ensureBundle, readBundleBase64 } from '../bundleStore';
import { readEnvironment, readFiles, writeFiles } from '../store';
import type { CustomMcpServer } from '../types';
import type { SandboxTransport } from './SandboxTransport';

export type SandboxPhase =
  | 'idle'
  | 'loading'
  | 'starting'
  | 'ready'
  | 'failed';

export interface SandboxState {
  phase: SandboxPhase;
  /** Set once the bundle is verified and the sandbox may be mounted. */
  bundleBase64: string | null;
  environment: Record<string, string>;
  /** The server's virtual filesystem as of the last run. */
  files: Record<string, string>;
  /** An MCP client for the running server. Null until `phase` is 'ready'. */
  client: AgentMcpClient | null;
  error: Error | null;
  /** The server's own diagnostics, newest last. Bounded. */
  logs: string[];
}

/** Enough to diagnose a server that will not start, not a transcript. */
const MAX_LOG_LINES = 100;

export function useSandboxedServer(server: CustomMcpServer | null) {
  const [state, setState] = useState<SandboxState>({
    phase: 'idle',
    bundleBase64: null,
    environment: {},
    files: {},
    client: null,
    error: null,
    logs: [],
  });

  // Guards against a resolved load being applied after the caller moved on to
  // a different server, which would mount the wrong bundle.
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;

    if (!server?.detected) {
      setState({
        phase: 'idle',
        bundleBase64: null,
        environment: {},
        files: {},
        client: null,
        error: null,
        logs: [],
      });
      return;
    }

    const { bundleId, sha256 } = server.detected;
    setState((previous) => ({ ...previous, phase: 'loading', error: null, client: null }));

    void (async () => {
      try {
        await ensureBundle(bundleId, sha256);
        const [base64, environment, files] = await Promise.all([
          readBundleBase64(bundleId),
          readEnvironment(server.id),
          readFiles(server.id),
        ]);
        if (generation.current !== current) return;
        setState((previous) => ({
          ...previous,
          phase: 'starting',
          bundleBase64: base64,
          environment,
          files,
        }));
      } catch (error) {
        if (generation.current !== current) return;
        setState((previous) => ({
          ...previous,
          phase: 'failed',
          error: error instanceof Error ? error : new Error(String(error)),
        }));
      }
    })();
  }, [server]);

  const onReady = useCallback((transport: SandboxTransport) => {
    void (async () => {
      try {
        const client = new Client({ name: 'creepyim-sandbox-client', version: '0.1.0' });
        await client.connect(transport as never);
        setState((previous) => ({
          ...previous,
          phase: 'ready',
          client: new AgentMcpClient(client),
        }));
      } catch (error) {
        setState((previous) => ({
          ...previous,
          phase: 'failed',
          error: error instanceof Error ? error : new Error(String(error)),
        }));
      }
    })();
  }, []);

  /**
   * Persist what the server wrote.
   *
   * Failures surface as an error rather than being swallowed: a store that has
   * hit its cap means the next restart silently loses the user's data, and
   * they should be told while the running server still holds it.
   */
  const onSaveFiles = useCallback(
    (files: Record<string, string>) => {
      if (!server) return;
      void writeFiles(server.id, files).catch((error: unknown) => {
        setState((previous) => ({
          ...previous,
          error: error instanceof Error ? error : new Error(String(error)),
        }));
      });
    },
    [server],
  );

  const onLog = useCallback((stream: string, text: string) => {
    setState((previous) => ({
      ...previous,
      logs: [...previous.logs, `[${stream}] ${text.trim()}`].slice(-MAX_LOG_LINES),
    }));
  }, []);

  const onError = useCallback((error: Error) => {
    setState((previous) => ({
      ...previous,
      // A server that has already started and then throws is still running;
      // only a failure before ready leaves nothing usable.
      phase: previous.phase === 'ready' ? previous.phase : 'failed',
      error,
    }));
  }, []);

  return { state, onReady, onLog, onError, onSaveFiles };
}
