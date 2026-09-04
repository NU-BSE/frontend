import { AppState, type AppStateStatus } from 'react-native';

import type { ForegroundGate } from './foregroundGate';

/**
 * A {@link ForegroundGate} backed by React Native's AppState.
 */
export function createAppStateForegroundGate(): ForegroundGate {
  /*
   * `inactive` is not backgrounded. On Android it appears while a system
   * dialog or the recents animation is on top, and treating it as "away"
   * would stall the agent on transitions the user never notices.
   */
  const isActive = (status: AppStateStatus): boolean => status !== 'background';

  return {
    isActive: () => isActive(AppState.currentState),

    waitUntilActive(signal?: AbortSignal): Promise<void> {
      if (isActive(AppState.currentState)) return Promise.resolve();
      if (signal?.aborted) return Promise.resolve();

      return new Promise<void>((resolve) => {
        const finish = () => {
          subscription.remove();
          signal?.removeEventListener('abort', finish);
          resolve();
        };

        const subscription = AppState.addEventListener('change', (status) => {
          if (isActive(status)) finish();
        });

        // Stopping the run must not leave a listener waiting for a return
        // that no longer matters; the caller re-checks the signal after.
        signal?.addEventListener('abort', finish);
      });
    },
  };
}
