/**
 * The download's state machine, kept out of the view.
 *
 * A download that survives a screen going away is not what this is: the
 * sandbox and this both live while their screen does. What it does guarantee
 * is that stopping leaves the partial file intact, so the next attempt resumes
 * rather than starting a gigabyte again.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DownloadCancelledError,
  getInstalledModel,
  installModel,
  removeInstalledModel,
  SubscriptionRequiredError,
  verifyInstalled,
  type DownloadProgress,
  type InstalledModel,
} from '@/ai/modelInstall';
import { getModelCatalog, type ModelBundleEntry } from '@/api/client';

export type InstallPhase =
  | 'checking'
  | 'not-installed'
  | 'downloading'
  | 'installed'
  | 'failed';

/**
 * Why the model cannot be downloaded right now.
 *
 * Three different causes used to collapse into one disabled button: the server
 * unreachable, the server publishing no weights, and the account not being
 * subscribed. A dead control that says none of them is the worst of the three
 * outcomes, because only one of them is the user's to fix.
 */
export type Blocker =
  | { kind: 'none' }
  | { kind: 'offline'; message: string }
  | { kind: 'nothing-published' }
  | { kind: 'subscription' };

export interface ModelInstallState {
  phase: InstallPhase;
  installed: InstalledModel | null;
  /** What the download would cost, before starting it. */
  bundle: ModelBundleEntry | null;
  downloadAllowed: boolean;
  blocker: Blocker;
  progress: DownloadProgress | null;
  error: Error | null;
}

export function useModelInstall(profile: string) {
  const [state, setState] = useState<ModelInstallState>({
    phase: 'checking',
    installed: null,
    bundle: null,
    downloadAllowed: false,
    blocker: { kind: 'none' },
    progress: null,
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Leaving the screen stops the download rather than letting it run
      // against a component that can no longer report it.
      abortRef.current?.abort();
    };
  }, []);

  const refresh = useCallback(async () => {
    setState((previous) => ({ ...previous, phase: 'checking', error: null }));
    try {
      const installed = await getInstalledModel();
      // The record is not trusted alone: clearing app storage leaves a path
      // that no longer exists, and handing that to llama.rn fails deep in
      // native code with nothing useful in the message.
      const valid = installed && (await verifyInstalled(installed));

      let bundle: ModelBundleEntry | null = null;
      let downloadAllowed = false;
      let blocker: Blocker = { kind: 'none' };
      try {
        const catalog = await getModelCatalog();
        bundle = catalog.bundles.find((item) => item.profile === profile) ?? null;
        downloadAllowed = catalog.downloadAllowed;
        if (!bundle) {
          // The catalogue answered and offered nothing for this profile. That
          // is a server that has not published its weights, not a user
          // problem, and telling them to subscribe would be wrong.
          blocker = { kind: 'nothing-published' };
        } else if (!downloadAllowed) {
          blocker = { kind: 'subscription' };
        }
      } catch (error) {
        // Offline with the model already here is a working state, so a failed
        // catalogue lookup must not present as "not installed".
        blocker = {
          kind: 'offline',
          message: error instanceof Error ? error.message : 'Could not reach the server.',
        };
      }

      if (!mountedRef.current) return;
      setState({
        phase: valid ? 'installed' : 'not-installed',
        installed: valid ? installed : null,
        bundle,
        downloadAllowed,
        blocker,
        progress: null,
        error: null,
      });
    } catch (error) {
      if (!mountedRef.current) return;
      setState((previous) => ({
        ...previous,
        phase: 'failed',
        error: error instanceof Error ? error : new Error(String(error)),
      }));
    }
  }, [profile]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const start = useCallback(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    setState((previous) => ({
      ...previous,
      phase: 'downloading',
      error: null,
      progress: null,
    }));

    void installModel({
      profile,
      signal: controller.signal,
      onProgress: (progress) => {
        if (!mountedRef.current) return;
        setState((previous) => ({ ...previous, progress }));
      },
    })
      .then((installed) => {
        if (!mountedRef.current) return;
        setState((previous) => ({
          ...previous,
          phase: 'installed',
          installed,
          progress: null,
        }));
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        if (error instanceof DownloadCancelledError) {
          // Stopping is not a failure; the partial file stays and resumes.
          setState((previous) => ({ ...previous, phase: 'not-installed', progress: null }));
          return;
        }
        setState((previous) => ({
          ...previous,
          phase: 'failed',
          error:
            error instanceof SubscriptionRequiredError || error instanceof Error
              ? error
              : new Error(String(error)),
        }));
      });
  }, [profile]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const remove = useCallback(async () => {
    await removeInstalledModel();
    await refresh();
  }, [refresh]);

  return { state, start, stop, remove, refresh };
}
