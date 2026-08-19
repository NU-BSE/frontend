/**
 * Platform-neutral contract between `AndroidConnector` and the real native
 * Android Settings module.
 *
 * The connector package must stay importable from Node (verification scripts,
 * Jest, `tsc`), so it only knows this interface and small pure TypeScript DTO
 * types. The real `creepy-android-settings` → `AndroidSettingsBridge` adapter
 * lives in the app layer (`src/connections/android/`) and is injected into the
 * connector — never imported here.
 */

/** Mirrors the native module's `SettingsScreen` union (all 24 screens). */
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

export interface AndroidSettingsBridge {
  getCapabilities(): AndroidSettingsCapabilities;

  canWriteSystemSettings(): boolean;
  requestWriteSystemSettingsPermission(): Promise<boolean>;

  canDrawOverlays(): boolean;
  requestOverlayPermission(): Promise<boolean>;

  getScreenBrightness(): number;
  getScreenBrightnessPercent(): number;

  setScreenBrightness(value: number): boolean;
  setScreenBrightnessPercent(percent: number): boolean;

  getScreenTimeout(): number;
  setScreenTimeout(milliseconds: number): boolean;

  getAutoRotate(): boolean;
  setAutoRotate(enabled: boolean): boolean;

  canOpenSettings(screen: SettingsScreen): boolean;
  openSettings(screen: SettingsScreen): Promise<boolean>;

  isSettingsPanelSupported(panel: SettingsPanel): boolean;
  openPanel(panel: SettingsPanel): Promise<boolean>;
}
