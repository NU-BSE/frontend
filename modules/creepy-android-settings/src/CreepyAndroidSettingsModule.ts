import { NativeModule, requireNativeModule } from 'expo';

import {
  assertBrightnessInRange,
  assertPercentInRange,
  assertScreenTimeoutNonNegative,
} from './conversion';
import type {
  AndroidSettingsCapabilities,
  CreepyAndroidSettingsAPI,
  CreepyAndroidSettingsEvents,
  SettingsNamespace,
  SettingsPanel,
  SettingsScreen,
} from './CreepyAndroidSettings.types';

declare class CreepyAndroidSettingsNativeModule extends NativeModule<CreepyAndroidSettingsEvents> {
  getCapabilities(): AndroidSettingsCapabilities;

  getSetting(namespace: string, key: string): string | null;
  getSettingInt(namespace: string, key: string, defaultValue: number): number;

  getSystemInt(key: string, defaultValue: number): number;
  getSystemString(key: string): string | null;
  getSystemFloat(key: string, defaultValue: number): number;
  getSystemLong(key: string, defaultValue: number): number;

  setSystemInt(key: string, value: number): boolean;
  setSystemString(key: string, value: string): boolean;
  setSystemFloat(key: string, value: number): boolean;
  setSystemLong(key: string, value: number): boolean;

  getSecureInt(key: string, defaultValue: number): number;
  getSecureString(key: string): string | null;
  getSecureFloat(key: string, defaultValue: number): number;
  getSecureLong(key: string, defaultValue: number): number;

  getGlobalInt(key: string, defaultValue: number): number;
  getGlobalString(key: string): string | null;
  getGlobalFloat(key: string, defaultValue: number): number;
  getGlobalLong(key: string, defaultValue: number): number;

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

  canOpenSettings(screen: string): boolean;
  openSettings(screen: string): Promise<boolean>;

  isSettingsPanelSupported(panel: string): boolean;
  openPanel(panel: string): Promise<boolean>;

  watchSetting(namespace: string, key: string): string;
  unwatchSetting(subscriptionId: string): void;
  unwatchAllSettings(): void;
}

const nativeModule =
  requireNativeModule<CreepyAndroidSettingsNativeModule>('CreepyAndroidSettings');

export const CreepyAndroidSettings: CreepyAndroidSettingsAPI = {
  getCapabilities: () => nativeModule.getCapabilities(),

  getSetting: (namespace: SettingsNamespace, key: string) => nativeModule.getSetting(namespace, key),
  getSettingInt: (namespace: SettingsNamespace, key: string, defaultValue?: number) =>
    nativeModule.getSettingInt(namespace, key, defaultValue ?? 0),

  getSystemInt: (key: string, defaultValue?: number) => nativeModule.getSystemInt(key, defaultValue ?? 0),
  getSystemString: (key: string) => nativeModule.getSystemString(key),
  getSystemFloat: (key: string, defaultValue?: number) => nativeModule.getSystemFloat(key, defaultValue ?? 0),
  getSystemLong: (key: string, defaultValue?: number) => nativeModule.getSystemLong(key, defaultValue ?? 0),

  setSystemInt: (key: string, value: number) => nativeModule.setSystemInt(key, value),
  setSystemString: (key: string, value: string) => nativeModule.setSystemString(key, value),
  setSystemFloat: (key: string, value: number) => nativeModule.setSystemFloat(key, value),
  setSystemLong: (key: string, value: number) => nativeModule.setSystemLong(key, value),

  getSecureInt: (key: string, defaultValue?: number) => nativeModule.getSecureInt(key, defaultValue ?? 0),
  getSecureString: (key: string) => nativeModule.getSecureString(key),
  getSecureFloat: (key: string, defaultValue?: number) => nativeModule.getSecureFloat(key, defaultValue ?? 0),
  getSecureLong: (key: string, defaultValue?: number) => nativeModule.getSecureLong(key, defaultValue ?? 0),

  getGlobalInt: (key: string, defaultValue?: number) => nativeModule.getGlobalInt(key, defaultValue ?? 0),
  getGlobalString: (key: string) => nativeModule.getGlobalString(key),
  getGlobalFloat: (key: string, defaultValue?: number) => nativeModule.getGlobalFloat(key, defaultValue ?? 0),
  getGlobalLong: (key: string, defaultValue?: number) => nativeModule.getGlobalLong(key, defaultValue ?? 0),

  canWriteSystemSettings: () => nativeModule.canWriteSystemSettings(),
  requestWriteSystemSettingsPermission: () => nativeModule.requestWriteSystemSettingsPermission(),
  canDrawOverlays: () => nativeModule.canDrawOverlays(),
  requestOverlayPermission: () => nativeModule.requestOverlayPermission(),

  getScreenBrightness: () => nativeModule.getScreenBrightness(),
  setScreenBrightness: (value: number) => {
    assertBrightnessInRange(value);
    return nativeModule.setScreenBrightness(value);
  },
  getScreenBrightnessPercent: () => nativeModule.getScreenBrightnessPercent(),
  setScreenBrightnessPercent: (percent: number) => {
    assertPercentInRange(percent);
    return nativeModule.setScreenBrightnessPercent(percent);
  },
  getScreenTimeout: () => nativeModule.getScreenTimeout(),
  setScreenTimeout: (milliseconds: number) => {
    assertScreenTimeoutNonNegative(milliseconds);
    return nativeModule.setScreenTimeout(milliseconds);
  },
  getAutoRotate: () => nativeModule.getAutoRotate(),
  setAutoRotate: (enabled: boolean) => nativeModule.setAutoRotate(enabled),

  canOpenSettings: (screen: SettingsScreen) => nativeModule.canOpenSettings(screen),
  openSettings: (screen: SettingsScreen) => nativeModule.openSettings(screen),

  isSettingsPanelSupported: (panel: SettingsPanel) => nativeModule.isSettingsPanelSupported(panel),
  openPanel: (panel: SettingsPanel) => nativeModule.openPanel(panel),

  watchSetting: (namespace: SettingsNamespace, key: string) => nativeModule.watchSetting(namespace, key),
  unwatchSetting: (subscriptionId: string) => nativeModule.unwatchSetting(subscriptionId),
  unwatchAllSettings: () => nativeModule.unwatchAllSettings(),

  addListener: (eventName, listener) => nativeModule.addListener(eventName, listener),
};
