import { getNativeModuleDiagnostics } from '@/native/lazyNativeModule';
import { getAndroidAssistantBridge } from './assistant-native-bridge';
import { getAndroidSettingsBridge } from './settings-native-bridge';
import * as media from '@/media/mediaControl';
import * as notifications from '@/notifications/reader/deviceNotifications';
import * as usage from '@/usage/usageStats';

export type NativeModuleHealthReason =
  | 'AVAILABLE'
  | 'MODULE_NOT_LINKED'
  | 'PLATFORM_UNSUPPORTED';

export interface AndroidNativeModuleHealth {
  /** The Expo/RN module name the JS reaches it by. */
  module: string;
  /** The capability it backs. */
  capability: string;
  available: boolean;
  reason: NativeModuleHealthReason;
  /** Live Android access grant, where the capability has one. */
  permissionGranted?: boolean;
}

/**
 * Aggregate health of every Android-native capability the app expects.
 *
 * "Available" here means the native module is actually linked into the build —
 * not that the user has granted the access. A module that a release build
 * should contain but does not is reported as MODULE_NOT_LINKED so it cannot be
 * mistaken for a user permission (or worse, silently collapse into "feature
 * unsupported"). This is the diagnostic surface for #12 / #16: it is used by
 * the dev harness and telemetry, never by the agent-facing capability list,
 * which is driven by the registered tool + scope gate.
 */
export function getAndroidNativeModulesHealth(): AndroidNativeModuleHealth[] {
  const health: AndroidNativeModuleHealth[] = [];

  const settings = getAndroidSettingsBridge();
  health.push({
    module: 'CreepyAndroidSettings',
    capability: 'Android Settings read/write/navigate',
    available: settings != null,
    reason: settings != null ? 'AVAILABLE' : 'MODULE_NOT_LINKED',
    permissionGranted:
      settings != null ? settings.canWriteSystemSettings() : undefined,
  });

  const usageHealth = getNativeModuleDiagnostics('UsageStats');
  health.push({
    module: 'UsageStats',
    capability: 'App usage history',
    available: usageHealth.present,
    reason: usageHealth.reason,
  });

  const notificationsHealth = getNativeModuleDiagnostics('NotificationReader');
  health.push({
    module: 'NotificationReader',
    capability: 'Notification shade read/reply',
    available: notificationsHealth.present,
    reason: notificationsHealth.reason,
  });

  const mediaHealth = getNativeModuleDiagnostics('MediaControl');
  health.push({
    module: 'MediaControl',
    capability: 'Media transport controls',
    available: mediaHealth.present,
    reason: mediaHealth.reason,
  });

  const assistant = getAndroidAssistantBridge();
  health.push({
    module: 'AssistantRole',
    capability: 'Assistant role + screen context',
    available: assistant != null,
    reason: assistant != null ? 'AVAILABLE' : 'MODULE_NOT_LINKED',
  });

  return health;
}

/**
 * Whether any expected Android module is missing from the build.
 *
 * Used by diagnostics to draw attention to a release that lost a module,
 * rather than letting the tools simply not register.
 */
export async function hasMissingNativeModules(): Promise<boolean> {
  return getAndroidNativeModulesHealth().some(
    (entry) => entry.available === false && entry.reason === 'MODULE_NOT_LINKED',
  );
}

/** Current live grant state for usage + notification access, for the UI. */
export async function getDeviceSignalGrantState(): Promise<{
  usageGranted: boolean;
  notificationsGranted: boolean;
  notificationsConnected: boolean;
  mediaAvailable: boolean;
}> {
  const [usageGranted, notificationsGranted, notificationsConnected, mediaAvailable] =
    await Promise.all([
      usage.isSupported() ? usage.hasPermission() : Promise.resolve(false),
      notifications.isSupported() ? notifications.hasPermission() : Promise.resolve(false),
      notifications.isSupported() ? notifications.isConnected() : Promise.resolve(false),
      media.isSupported(),
    ]);
  return {
    usageGranted,
    notificationsGranted,
    notificationsConnected,
    mediaAvailable,
  };
}