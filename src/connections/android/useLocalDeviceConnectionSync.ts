import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { refreshLocalDeviceConnections } from '@/mcp/runtime-singleton';
import { CONNECTIONS_QUERY_KEY } from '@/connections/useConnections';
import { ANDROID_DEVICE_ACCESS_QUERY_KEY } from './useAndroidDeviceAccess';

/**
 * Re-derive the local device connections whenever the app comes back.
 *
 * "Modify system settings" and "Display over other apps" are granted on
 * Android's own screens, outside this app. `AndroidConnector.connect()` reads
 * them once and writes the resulting scopes onto the connection record, so a
 * record created before the grant goes on claiming the permission is absent —
 * and `android.settings.set_brightness` goes on failing with "missing required
 * scopes: android.settings.write" long after the user granted it. Only an app
 * restart used to clear that.

 * This is mounted at the provider, not on the device-access screen, because
 * the sequence that matters happens elsewhere: the agent fails in chat, the
 * user leaves to grant the permission, and comes back to chat. A hook living
 * on the settings screen would be unmounted for all of it.
 */
export function useLocalDeviceConnectionSync(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;

      void refreshLocalDeviceConnections().then(() => {
        void queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
        void queryClient.invalidateQueries({
          queryKey: ANDROID_DEVICE_ACCESS_QUERY_KEY,
        });
      });
    });
    return () => subscription.remove();
  }, [queryClient]);
}
