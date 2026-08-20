import type {
  AndroidSettingsBridge,
  AndroidSettingsCapabilities,
  SettingsPanel,
  SettingsScreen,
} from '@mobile-agent/connector-android';

/**
 * Raw surface of the `CreepyAndroidSettings` Expo native module (Kotlin).
 * The native module is reached through `requireNativeModule` rather than the
 * `creepy-android-settings` TS wrapper so this file never pulls `expo` into
 * the Node verification bundles.
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
  canOpenSettings(screen: string): boolean;
  openSettings(screen: string): Promise<boolean>;
  isSettingsPanelSupported(panel: string): boolean;
  openPanel(panel: string): Promise<boolean>;
};

/**
 * Returns the native Android Settings bridge on Android, or `null` when
 * absent (iOS, web, Node, or a build without the native module).
 *
 * `react-native` and `expo-modules-core` are loaded lazily with guarded
 * `require` calls so this module is safe to import from Node verification
 * scripts — in Node both `require` calls throw and are caught.
 */
export function getAndroidSettingsBridge(): AndroidSettingsBridge | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native') as typeof import('react-native');
    if (Platform.OS !== 'android') return null;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireNativeModule } = require('expo-modules-core') as {
      requireNativeModule: <T>(name: string) => T | null;
    };

    const native = requireNativeModule<NativeAndroidSettingsModule>(
      'CreepyAndroidSettings',
    );
    if (!native) return null;

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

      canOpenSettings: (screen: SettingsScreen) =>
        native.canOpenSettings(screen),
      openSettings: (screen: SettingsScreen) => native.openSettings(screen),

      isSettingsPanelSupported: (panel: SettingsPanel) =>
        native.isSettingsPanelSupported(panel),
      openPanel: (panel: SettingsPanel) => native.openPanel(panel),
    };
  } catch {
    return null;
  }
}
