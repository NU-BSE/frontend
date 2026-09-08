import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import type { AssistantStatus } from '@mobile-agent/connector-android';
import { getAndroidAssistantBridge } from './assistant-native-bridge';

/**
 * Live assistant role state.
 *
 * The role is granted on Android's own role dialog or Default-apps screen and
 * reports nothing back, so the only way to learn the outcome is to re-read
 * after the app returns to the foreground.
 */
export function useAssistantAccess(): {
  status: AssistantStatus | null;
  available: boolean;
  requestRole(): void;
  openSettings(): void;
  refresh(): void;
} {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const available = getAndroidAssistantBridge() != null;

const refresh = useCallback(() => {
  const bridge = getAndroidAssistantBridge();
  // The bridge lookup can be null; the setState stays inside the async
  // callback so it is never synchronous in the effect body.
  void (async () => {
    if (!bridge) {
      setStatus(null);
      return;
    }
    setStatus(await bridge.getStatus());
  })();
}, []);

  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const requestRole = useCallback(() => {
    const bridge = getAndroidAssistantBridge();
    void bridge?.requestRole().then(() => refresh());
  }, [refresh]);

  const openSettings = useCallback(() => {
    const bridge = getAndroidAssistantBridge();
    void bridge?.openSettings().then(() => refresh());
  }, [refresh]);

  return { status, available, requestRole, openSettings, refresh };
}