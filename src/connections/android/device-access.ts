import { getAndroidSettingsBridge } from './settings-native-bridge';

/**
 * Pure, UI-facing snapshot of what the Android Settings bridge can actually do
 * on this device. The UI reads this instead of touching the native module, so
 * it never depends on Kotlin implementation details.
 */
export interface AndroidDeviceAccessState {
  nativeAvailable: boolean;
  readSettings: boolean;
  writeSettings: boolean;
  overlay: boolean;
  device?: {
    manufacturer: string;
    model: string;
    apiLevel: number;
  };
}

export async function getAndroidDeviceAccessState(): Promise<AndroidDeviceAccessState> {
  const bridge = getAndroidSettingsBridge();
  if (!bridge) {
    return {
      nativeAvailable: false,
      readSettings: false,
      writeSettings: false,
      overlay: false,
    };
  }

  const capabilities = bridge.getCapabilities();

  return {
    nativeAvailable: true,
    // Reading Settings.System/Secure/Global is always available to a normal
    // app; only writes and overlay are gated behind special access.
    readSettings: true,
    writeSettings: bridge.canWriteSystemSettings(),
    overlay: bridge.canDrawOverlays(),
    device: {
      manufacturer: capabilities.manufacturer,
      model: capabilities.model,
      apiLevel: capabilities.apiLevel,
    },
  };
}

/**
 * Opens the Android "Modify system settings" special-access screen. The
 * resolved value is the *current* state, not a guarantee the user granted it —
 * callers must re-read `canWriteSystemSettings()` after the user returns.
 */
export async function requestWriteSystemSettingsPermission(): Promise<boolean> {
  const bridge = getAndroidSettingsBridge();
  if (!bridge) return false;
  return bridge.requestWriteSystemSettingsPermission();
}

/**
 * Opens the Android "Display over other apps" special-access screen. The
 * resolved value is the *current* state, not a grant confirmation.
 */
export async function requestOverlayPermission(): Promise<boolean> {
  const bridge = getAndroidSettingsBridge();
  if (!bridge) return false;
  return bridge.requestOverlayPermission();
}
