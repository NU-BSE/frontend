import type { EventSubscription } from 'expo-modules-core';

export type SettingsNamespace = 'system' | 'secure' | 'global';

export type SettingsScreen =
  | 'settings'
  | 'appDetails'
  | 'wifi'
  | 'bluetooth'
  | 'wireless'
  | 'location'
  | 'display'
  | 'sound'
  | 'notifications'
  | 'accessibility'
  | 'usageAccess'
  | 'notificationListener'
  | 'overlay'
  | 'writeSettings'
  | 'batteryOptimization'
  | 'unknownSources'
  | 'security'
  | 'privacy'
  | 'vpn'
  | 'nfc'
  | 'language'
  | 'dateTime'
  | 'keyboard'
  | 'developerOptions';

export type SettingsPanel = 'internet' | 'wifi' | 'volume' | 'nfc';

export interface AndroidSettingsCapabilities {
  platform: 'android';
  apiLevel: number;
  manufacturer: string;
  model: string;
  canWriteSystemSettings: boolean;
  canDrawOverlays: boolean;
  settingsPanelsSupported: boolean;
  supportedScreens: Partial<Record<SettingsScreen, boolean>>;
}

export type SettingValue = string | number | null;

export interface SettingChangedEvent {
  subscriptionId: string;
  namespace: SettingsNamespace;
  key: string;
  value: SettingValue;
  timestamp: number;
}

export type CreepyAndroidSettingsEvents = {
  onSettingChanged: (event: SettingChangedEvent) => void;
};

export interface CreepyAndroidSettingsAPI {
  // Capabilities
  getCapabilities(): AndroidSettingsCapabilities;

  // Generic reads
  getSetting(namespace: SettingsNamespace, key: string): string | null;
  getSettingInt(namespace: SettingsNamespace, key: string, defaultValue?: number): number;

  // Settings.System
  getSystemInt(key: string, defaultValue?: number): number;
  getSystemString(key: string): string | null;
  getSystemFloat(key: string, defaultValue?: number): number;
  getSystemLong(key: string, defaultValue?: number): number;

  // LOW LEVEL API — prefer the high-level helpers below.
  setSystemInt(key: string, value: number): boolean;
  setSystemString(key: string, value: string): boolean;
  setSystemFloat(key: string, value: number): boolean;
  setSystemLong(key: string, value: number): boolean;

  // Settings.Secure (read-only)
  getSecureInt(key: string, defaultValue?: number): number;
  getSecureString(key: string): string | null;
  getSecureFloat(key: string, defaultValue?: number): number;
  getSecureLong(key: string, defaultValue?: number): number;

  // Settings.Global (read-only)
  getGlobalInt(key: string, defaultValue?: number): number;
  getGlobalString(key: string): string | null;
  getGlobalFloat(key: string, defaultValue?: number): number;
  getGlobalLong(key: string, defaultValue?: number): number;

  // Special access
  canWriteSystemSettings(): boolean;
  requestWriteSystemSettingsPermission(): Promise<boolean>;
  canDrawOverlays(): boolean;
  requestOverlayPermission(): Promise<boolean>;

  // High-level settings
  getScreenBrightness(): number;
  setScreenBrightness(value: number): boolean;
  getScreenBrightnessPercent(): number;
  setScreenBrightnessPercent(percent: number): boolean;
  getScreenTimeout(): number;
  setScreenTimeout(milliseconds: number): boolean;
  getAutoRotate(): boolean;
  setAutoRotate(enabled: boolean): boolean;

  // Navigation
  canOpenSettings(screen: SettingsScreen): boolean;
  openSettings(screen: SettingsScreen): Promise<boolean>;

  // Panels
  isSettingsPanelSupported(panel: SettingsPanel): boolean;
  openPanel(panel: SettingsPanel): Promise<boolean>;

  // Observer
  watchSetting(namespace: SettingsNamespace, key: string): string;
  unwatchSetting(subscriptionId: string): void;
  unwatchAllSettings(): void;

  // Events
  addListener(
    eventName: 'onSettingChanged',
    listener: (event: SettingChangedEvent) => void,
  ): EventSubscription;
}
