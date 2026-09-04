import type { DeviceSignalBridge } from '@mobile-agent/connector-android';

import * as media from '@/media/mediaControl';
import * as notifications from '@/notifications/reader/deviceNotifications';
import * as usage from '@/usage/usageStats';

/**
 * Binds the Phase 4 native modules to the connector's bridge contract.
 *
 * Returns null unless at least one of the three is present. Registering the
 * tools when none is available would offer the model capabilities that can
 * only answer "unavailable" — the registry's rule is that a tool exists only
 * if the build can actually perform it.
 */
export function getDeviceSignalBridge(): DeviceSignalBridge | null {
  if (!usage.isSupported() && !notifications.isSupported() && !media.isSupported()) {
    return null;
  }

  return {
    usage: {
      hasPermission: () => usage.hasPermission(),
      recent: (days) => usage.recentUsage(days),
    },
    notifications: {
      hasPermission: () => notifications.hasPermission(),
      list: () => notifications.getNotifications(),
      reply: (key, message) => notifications.reply(key, message),
    },
    media: {
      nowPlaying: () => media.getNowPlaying(),
      play: () => media.play(),
      pause: () => media.pause(),
      next: () => media.next(),
      previous: () => media.previous(),
      setVolume: (fraction) => media.setVolume(fraction),
      getVolume: () => media.getVolume(),
    },
  };
}
