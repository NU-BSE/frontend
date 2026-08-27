import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import * as notifications from '@/notifications/reader/deviceNotifications';
import * as usage from '@/usage/usageStats';

/**
 * Live grant state for the two access types that have no dialog.
 *
 * Usage access and notification access are granted on system screens, and
 * neither reports a result. The only way to learn the answer is to look again
 * once the user comes back, so this re-reads on every return to the
 * foreground rather than after the call that opened the screen.
 */
export interface DeviceSignalAccess {
  usageGranted: boolean;
  notificationsGranted: boolean;
  /**
   * The listener is bound, not merely permitted.
   *
   * Distinct from `notificationsGranted`: Android binds asynchronously after
   * the grant, so there is a window where access exists and the shade still
   * reads empty. Collapsing the two makes that window look like a bug.
   */
  notificationsConnected: boolean;
  openUsageSettings(): void;
  openNotificationSettings(): void;
  refresh(): void;
}

export function useDeviceSignalAccess(): DeviceSignalAccess {
  const [usageGranted, setUsageGranted] = useState(false);
  const [notificationsGranted, setNotificationsGranted] = useState(false);
  const [notificationsConnected, setNotificationsConnected] = useState(false);

  const refresh = useCallback(() => {
    void (async () => {
      const [granted, notify, connected] = await Promise.all([
        usage.hasPermission(),
        notifications.hasPermission(),
        notifications.isConnected(),
      ]);
      setUsageGranted(granted);
      setNotificationsGranted(notify);
      setNotificationsConnected(connected);
    })();
  }, []);

  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const openUsageSettings = useCallback(() => {
    void usage.openSettings();
  }, []);

  const openNotificationSettings = useCallback(() => {
    void notifications.openSettings();
  }, []);

  return {
    usageGranted,
    notificationsGranted,
    notificationsConnected,
    openUsageSettings,
    openNotificationSettings,
    refresh,
  };
}
