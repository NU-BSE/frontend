import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { getAndroidDeviceAccessState } from './device-access';

export const ANDROID_DEVICE_ACCESS_QUERY_KEY = [
  'android-device-access',
] as const;

/**
 * Live Android device-access state, refreshed on mount and whenever the app
 * returns to the foreground — the user grants WRITE_SETTINGS / overlay on a
 * separate system screen and the state must re-sync without a manual reload.
 */
export function useAndroidDeviceAccess() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ANDROID_DEVICE_ACCESS_QUERY_KEY,
    queryFn: getAndroidDeviceAccessState,
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void queryClient.invalidateQueries({
          queryKey: ANDROID_DEVICE_ACCESS_QUERY_KEY,
        });
      }
    });
    return () => subscription.remove();
  }, [queryClient]);

  return query;
}
