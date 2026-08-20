import type { EventSubscription } from 'expo-modules-core';

import type { CreepyAndroidSettingsAPI } from './CreepyAndroidSettings.types';

function platformNotSupported(): never {
  const error = new Error(
    'ERR_PLATFORM_NOT_SUPPORTED: CreepyAndroidSettings is only available on Android.',
  ) as Error & { code: string };
  error.code = 'ERR_PLATFORM_NOT_SUPPORTED';
  throw error;
}

function noopSubscription(): EventSubscription {
  return { remove: () => {} };
}

/**
 * Web stub. The Android Settings provider does not exist outside Android, so
 * every call fails with a normalized `ERR_PLATFORM_NOT_SUPPORTED` error.
 */
export const CreepyAndroidSettings: CreepyAndroidSettingsAPI = {
  getCapabilities: () => platformNotSupported(),

  getSetting: () => platformNotSupported(),
  getSettingInt: () => platformNotSupported(),

  getSystemInt: () => platformNotSupported(),
  getSystemString: () => platformNotSupported(),
  getSystemFloat: () => platformNotSupported(),
  getSystemLong: () => platformNotSupported(),

  setSystemInt: () => platformNotSupported(),
  setSystemString: () => platformNotSupported(),
  setSystemFloat: () => platformNotSupported(),
  setSystemLong: () => platformNotSupported(),

  getSecureInt: () => platformNotSupported(),
  getSecureString: () => platformNotSupported(),
  getSecureFloat: () => platformNotSupported(),
  getSecureLong: () => platformNotSupported(),

  getGlobalInt: () => platformNotSupported(),
  getGlobalString: () => platformNotSupported(),
  getGlobalFloat: () => platformNotSupported(),
  getGlobalLong: () => platformNotSupported(),

  canWriteSystemSettings: () => platformNotSupported(),
  requestWriteSystemSettingsPermission: () => platformNotSupported(),
  canDrawOverlays: () => platformNotSupported(),
  requestOverlayPermission: () => platformNotSupported(),

  getScreenBrightness: () => platformNotSupported(),
  setScreenBrightness: () => platformNotSupported(),
  getScreenBrightnessPercent: () => platformNotSupported(),
  setScreenBrightnessPercent: () => platformNotSupported(),
  getScreenTimeout: () => platformNotSupported(),
  setScreenTimeout: () => platformNotSupported(),
  getAutoRotate: () => platformNotSupported(),
  setAutoRotate: () => platformNotSupported(),

  canOpenSettings: () => platformNotSupported(),
  openSettings: () => platformNotSupported(),

  isSettingsPanelSupported: () => platformNotSupported(),
  openPanel: () => platformNotSupported(),

  watchSetting: () => platformNotSupported(),
  unwatchSetting: () => platformNotSupported(),
  unwatchAllSettings: () => platformNotSupported(),

  addListener: () => noopSubscription(),
};
