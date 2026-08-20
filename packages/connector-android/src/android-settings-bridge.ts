/**
 * Platform-neutral contract between AndroidConnector and the native Android
 * device module. The connector package never imports Expo or React Native.
 */

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
  | 'developerOptions'
  | 'apps'
  | 'allApps'
  | 'defaultApps'
  | 'home'
  | 'batterySaver'
  | 'dataUsage'
  | 'airplaneMode'
  | 'apn'
  | 'roaming'
  | 'doNotDisturb'
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
  | 'backgroundData';

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
}
