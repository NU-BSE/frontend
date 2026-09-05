import type { EventSubscription } from 'expo-modules-core';

export type SettingsNamespace = 'system' | 'secure' | 'global';

export type SettingsScreen =
  | 'settings'
  | 'settingsSearch'
  | 'appDetails'
  | 'wifi'
  | 'wifiIp'
  | 'bluetooth'
  | 'wireless'
  | 'location'
  | 'display'
  | 'sound'
  | 'notifications'
  | 'accessibility'
  | 'assistant'
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
  | 'developerOptions'
  | 'apps'
  | 'allApps'
  | 'defaultApps'
  | 'home'
  | 'batterySaver'
  | 'batteryUsage'
  | 'dataUsage'
  | 'airplaneMode'
  | 'apn'
  | 'roaming'
  | 'doNotDisturb'
  | 'doNotDisturbPriority'
  | 'storage'
  | 'deviceInfo'
  | 'systemUpdate'
  | 'sync'
  | 'addAccount'
  | 'userDictionary'
  | 'hardwareKeyboard'
  | 'captioning'
  | 'cast'
  | 'print'
  | 'dream'
  | 'autoRotateSettings'
  | 'webView'
  | 'allNotifications';

export type AppSettingsTarget =
  | 'appDetails'
  | 'appNotifications'
  | 'notificationChannel'
  | 'notificationBubbles'
  | 'appOpenByDefault'
  | 'appLocale'
  | 'appUsage'
  | 'backgroundData'
  | 'exactAlarm'
  | 'fullScreenIntent';

export type SettingsPanel = 'internet' | 'wifi' | 'volume' | 'nfc';
export type BrightnessMode = 'manual' | 'automatic';

export interface InstalledAppSummary {
  packageName: string;
  label: string;
  enabled: boolean;
  systemApp: boolean;
  launchable: boolean;
}

export interface AndroidAppInfo extends InstalledAppSummary {
  versionName: string | null;
  versionCode: number | null;
}

export interface AndroidSettingsCapabilities {
  platform: 'android';
  apiLevel: number;
  manufacturer: string;
  model: string;
  canWriteSystemSettings: boolean;
  canDrawOverlays: boolean;
  settingsPanelsSupported: boolean;
  supportedScreens: Partial<Record<SettingsScreen, boolean>>;
  supportedAppTargets: Partial<Record<AppSettingsTarget, boolean>>;
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
  getCapabilities(): AndroidSettingsCapabilities;

  getSetting(namespace: SettingsNamespace, key: string): string | null;
  getSettingInt(namespace: SettingsNamespace, key: string, defaultValue?: number): number;

  getSystemInt(key: string, defaultValue?: number): number;
  getSystemString(key: string): string | null;
  getSystemFloat(key: string, defaultValue?: number): number;
  getSystemLong(key: string, defaultValue?: number): number;

  setSystemInt(key: string, value: number): boolean;
  setSystemString(key: string, value: string): boolean;
  setSystemFloat(key: string, value: number): boolean;
  setSystemLong(key: string, value: number): boolean;

  getSecureInt(key: string, defaultValue?: number): number;
  getSecureString(key: string): string | null;
  getSecureFloat(key: string, defaultValue?: number): number;
  getSecureLong(key: string, defaultValue?: number): number;

  getGlobalInt(key: string, defaultValue?: number): number;
  getGlobalString(key: string): string | null;
  getGlobalFloat(key: string, defaultValue?: number): number;
  getGlobalLong(key: string, defaultValue?: number): number;

  canWriteSystemSettings(): boolean;
  requestWriteSystemSettingsPermission(): Promise<boolean>;
  canDrawOverlays(): boolean;
  requestOverlayPermission(): Promise<boolean>;

  getScreenBrightness(): number;
  setScreenBrightness(value: number): boolean;
  getScreenBrightnessPercent(): number;
  setScreenBrightnessPercent(percent: number): boolean;
  getScreenTimeout(): number;
  setScreenTimeout(milliseconds: number): boolean;
  getAutoRotate(): boolean;
  setAutoRotate(enabled: boolean): boolean;
  getBrightnessMode(): BrightnessMode;
  setBrightnessMode(mode: BrightnessMode): boolean;
  getHapticFeedbackEnabled(): boolean;
  setHapticFeedbackEnabled(enabled: boolean): boolean;
  getSoundEffectsEnabled(): boolean;
  setSoundEffectsEnabled(enabled: boolean): boolean;

  canOpenSettings(screen: SettingsScreen): boolean;
  openSettings(screen: SettingsScreen): Promise<boolean>;
  canOpenAppSettings(
    target: AppSettingsTarget,
    packageName: string,
    channelId?: string,
  ): boolean;
  openAppSettings(
    target: AppSettingsTarget,
    packageName: string,
    channelId?: string,
  ): Promise<boolean>;

  isSettingsPanelSupported(panel: SettingsPanel): boolean;
  openPanel(panel: SettingsPanel): Promise<boolean>;

  findApps(query: string, limit?: number): InstalledAppSummary[];
  getAppInfo(packageName: string): AndroidAppInfo | null;

  intentOpenUri(uri: string): Promise<boolean>;
  intentOpenApp(packageName: string): Promise<boolean>;
  intentShareText(text: string, targetPackage?: string): Promise<boolean>;
  intentShareFile(
    fileUri: string,
    mimeType?: string,
    targetPackage?: string,
  ): Promise<boolean>;
  intentComposeEmail(to?: string, subject?: string, body?: string): Promise<boolean>;
  intentOpenMap(
    query?: string,
    latitude?: number,
    longitude?: number,
  ): Promise<boolean>;
  intentOpenDialer(phoneNumber?: string): Promise<boolean>;

  watchSetting(namespace: SettingsNamespace, key: string): string;
  unwatchSetting(subscriptionId: string): void;
  unwatchAllSettings(): void;

  addListener(
    eventName: 'onSettingChanged',
    listener: (event: SettingChangedEvent) => void,
  ): EventSubscription;
}
