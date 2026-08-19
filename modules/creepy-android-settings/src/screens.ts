import type { SettingsPanel, SettingsScreen } from './CreepyAndroidSettings.types';

/**
 * The complete set of Android Settings screens this module can open.
 *
 * The native `SettingsNavigator` owns the authoritative `ACTION_*` mapping;
 * this list mirrors it so consumers (and the future MCP connector) can
 * enumerate available screens without touching Kotlin.
 */
export const SETTINGS_SCREENS: readonly SettingsScreen[] = [
  'settings',
  'appDetails',
  'wifi',
  'bluetooth',
  'wireless',
  'location',
  'display',
  'sound',
  'notifications',
  'accessibility',
  'usageAccess',
  'notificationListener',
  'overlay',
  'writeSettings',
  'batteryOptimization',
  'unknownSources',
  'security',
  'privacy',
  'vpn',
  'nfc',
  'language',
  'dateTime',
  'keyboard',
  'developerOptions',
];

/**
 * Android Settings Panels (API 29+): Internet Connectivity, Wi-Fi, Volume, NFC.
 */
export const SETTINGS_PANELS: readonly SettingsPanel[] = [
  'internet',
  'wifi',
  'volume',
  'nfc',
];
