import type {
  AndroidAppInfo,
  AndroidSettingsBridge,
  AndroidSettingsCapabilities,
  AppSettingsTarget,
  BrightnessMode,
  InstalledAppSummary,
  SettingsPanel,
  SettingsScreen,
} from '@mobile-agent/connector-android';

const DEV_LOG = typeof __DEV__ === 'boolean' && __DEV__;

/**
 * Raw surface of the `CreepyAndroidSettings` Expo native module (Kotlin).
 * Reached through requireOptionalNativeModule so this adapter remains import-safe in
 * Node verification bundles.
 */
type NativeAndroidSettingsModule = {
  getCapabilities(): {
    platform: string;
    apiLevel: number;
    manufacturer: string;
    model: string;
    canWriteSystemSettings: boolean;
    canDrawOverlays: boolean;
    settingsPanelsSupported: boolean;
    supportedScreens: Record<string, boolean>;
    supportedAppTargets: Record<string, boolean>;
  };
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
  canOpenSettings(screen: string): boolean;
  openSettings(screen: string): Promise<boolean>;
  canOpenAppSettings(target: string, packageName: string, channelId: string | null): boolean;
  openAppSettings(target: string, packageName: string, channelId: string | null): Promise<boolean>;
  isSettingsPanelSupported(panel: string): boolean;
  openPanel(panel: string): Promise<boolean>;
  findApps(query: string, limit: number): InstalledAppSummary[];
  getAppInfo(packageName: string): AndroidAppInfo | null;
};

/**
 * Returns the native Android Settings bridge on Android, or null when absent
 * (iOS, web, Node or a build without the native module).
 */
export function getAndroidSettingsBridge(): AndroidSettingsBridge | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native') as typeof import('react-native');
    if (Platform.OS !== 'android') return null;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo-modules-core') as {
      requireOptionalNativeModule: <T>(name: string) => T | null;
    };

    const native = requireOptionalNativeModule<NativeAndroidSettingsModule>(
      'CreepyAndroidSettings',
    );
    if (!native) {
      if (DEV_LOG) {
        console.warn(
          '[android-settings] CreepyAndroidSettings native module is not linked; ' +
            'Android Settings tools will not be registered.',
        );
      }
      return null;
    }

    return {
      getCapabilities: (): AndroidSettingsCapabilities => {
        const caps = native.getCapabilities();
        return {
          platform: 'android',
          apiLevel: caps.apiLevel,
          manufacturer: caps.manufacturer,
          model: caps.model,
          canWriteSystemSettings: caps.canWriteSystemSettings,
          canDrawOverlays: caps.canDrawOverlays,
          settingsPanelsSupported: caps.settingsPanelsSupported,
          supportedScreens: caps.supportedScreens as Partial<
            Record<SettingsScreen, boolean>
          >,
          supportedAppTargets: caps.supportedAppTargets as Partial<
            Record<AppSettingsTarget, boolean>
          >,
        };
      },

      canWriteSystemSettings: () => native.canWriteSystemSettings(),
      requestWriteSystemSettingsPermission: () =>
        native.requestWriteSystemSettingsPermission(),

      canDrawOverlays: () => native.canDrawOverlays(),
      requestOverlayPermission: () => native.requestOverlayPermission(),

      getScreenBrightness: () => native.getScreenBrightness(),
      getScreenBrightnessPercent: () => native.getScreenBrightnessPercent(),
      setScreenBrightness: (value: number) => native.setScreenBrightness(value),
      setScreenBrightnessPercent: (percent: number) =>
        native.setScreenBrightnessPercent(percent),

      getScreenTimeout: () => native.getScreenTimeout(),
      setScreenTimeout: (milliseconds: number) =>
        native.setScreenTimeout(milliseconds),

      getAutoRotate: () => native.getAutoRotate(),
      setAutoRotate: (enabled: boolean) => native.setAutoRotate(enabled),

      getBrightnessMode: () => native.getBrightnessMode(),
      setBrightnessMode: (mode: BrightnessMode) => native.setBrightnessMode(mode),

      getHapticFeedbackEnabled: () => native.getHapticFeedbackEnabled(),
      setHapticFeedbackEnabled: (enabled: boolean) =>
        native.setHapticFeedbackEnabled(enabled),

      getSoundEffectsEnabled: () => native.getSoundEffectsEnabled(),
      setSoundEffectsEnabled: (enabled: boolean) =>
        native.setSoundEffectsEnabled(enabled),

      canOpenSettings: (screen: SettingsScreen) => native.canOpenSettings(screen),
      openSettings: (screen: SettingsScreen) => native.openSettings(screen),

      canOpenAppSettings: (
        target: AppSettingsTarget,
        packageName: string,
        channelId?: string,
      ) => native.canOpenAppSettings(target, packageName, channelId ?? null),
      openAppSettings: (
        target: AppSettingsTarget,
        packageName: string,
        channelId?: string,
      ) => native.openAppSettings(target, packageName, channelId ?? null),

      isSettingsPanelSupported: (panel: SettingsPanel) =>
        native.isSettingsPanelSupported(panel),
      openPanel: (panel: SettingsPanel) => native.openPanel(panel),

      findApps: (query: string, limit?: number) =>
        native.findApps(query, limit ?? 20),
      getAppInfo: (packageName: string) => native.getAppInfo(packageName),
    };
  } catch (error) {
    if (DEV_LOG) {
      console.warn(
        '[android-settings] Failed to initialize the native Settings bridge; ' +
          'Android Settings tools will not be registered.',
        error,
      );
    }
    return null;
  }
}
