# creepy-android-settings

Android Settings bridge for **Creepy.IM**, built on the **Expo Modules API** in
Kotlin. It exposes `Settings.System` / `Settings.Secure` / `Settings.Global`
reads, limited `Settings.System` writes, Settings navigation, Settings Panels,
overlay access helpers and a `ContentObserver`-backed change stream.

This module is **Android-only**. iOS and Web ship a stub that throws
`ERR_PLATFORM_NOT_SUPPORTED`.

## Purpose

The module is the stable native API that a future **Creepy.IM Android
Connector** (MCP tools → connector → `CreepyAndroidSettings` → Android SDK) will
sit on top of. It deliberately exposes only what a normal Android app is
allowed to do and never attempts to bypass the Android permission system.

## Installation

The module lives in the `modules/creepy-android-settings/` directory and is
auto-linked by `expo-modules-autolinking`. Add it to your workspaces (already
done in this repo) and install:

```bash
npm install
```

Then rebuild the native project:

```bash
npx expo run:android
```

## Android requirements

- `android.permission.WRITE_SETTINGS` is declared in the module's
  `AndroidManifest.xml`.
- `WRITE_SETTINGS` is a *special access*, not a runtime permission. It is
  granted through a dedicated system screen, not `requestPermissions()`.

### WRITE_SETTINGS behavior

- Check current state with `canWriteSystemSettings()`.
- Request it with `requestWriteSystemSettingsPermission()`, which opens
  `Settings.ACTION_MANAGE_WRITE_SETTINGS` scoped to the app.
- The promise resolves with the *current* state, not a guarantee — the user may
  deny the toggle, so re-check `canWriteSystemSettings()` after returning.

### Overlay behavior

- Check with `canDrawOverlays()`.
- Request with `requestOverlayPermission()`, which opens
  `Settings.ACTION_MANAGE_OVERLAY_PERMISSION` scoped to the app.

## Settings namespaces

| Namespace        | Read | Write | Notes                                                              |
| ---------------- | ---- | ----- | ------------------------------------------------------------------ |
| `Settings.System` | yes | limited | Read + write with `WRITE_SETTINGS`.                                |
| `Settings.Secure` | yes | no     | Read-only for ordinary apps.                                       |
| `Settings.Global` | yes | no     | Read-only for ordinary apps.                                       |

Android defines `Settings` as the provider of global system preferences.
`Settings.Secure` holds values that ordinary apps cannot arbitrarily change;
no generic `setSecure*` / `setGlobal*` API is exposed.

## API reference

```ts
import { CreepyAndroidSettings } from 'creepy-android-settings';
```

### Capabilities

- `getCapabilities(): AndroidSettingsCapabilities`

### Generic reads

- `getSetting(namespace, key): string | null`
- `getSettingInt(namespace, key, defaultValue?): number`

### Settings.System

- `getSystemInt(key, defaultValue?)`, `getSystemString(key)`,
  `getSystemFloat(key, defaultValue?)`, `getSystemLong(key, defaultValue?)`
- `setSystemInt(key, value)`, `setSystemString(key, value)`,
  `setSystemFloat(key, value)`, `setSystemLong(key, value)` — **LOW LEVEL API**.
  Prefer the high-level helpers below.

### Settings.Secure / Settings.Global (read-only)

- `getSecureInt/getSecureString/getSecureFloat/getSecureLong`
- `getGlobalInt/getGlobalString/getGlobalFloat/getGlobalLong`

### Special access

- `canWriteSystemSettings(): boolean`
- `requestWriteSystemSettingsPermission(): Promise<boolean>`
- `canDrawOverlays(): boolean`
- `requestOverlayPermission(): Promise<boolean>`

### High-level settings

- `getScreenBrightness(): number` (native range `0..255`)
- `setScreenBrightness(value): boolean`
- `getScreenBrightnessPercent(): number` (`0..100`)
- `setScreenBrightnessPercent(percent): boolean`
- `getScreenTimeout(): number` (milliseconds)
- `setScreenTimeout(milliseconds): boolean` (`>= 0`)
- `getAutoRotate(): boolean`
- `setAutoRotate(enabled): boolean`

### Navigation

- `canOpenSettings(screen: SettingsScreen): boolean`
- `openSettings(screen: SettingsScreen): Promise<boolean>`

Supported screens: `settings`, `appDetails`, `wifi`, `bluetooth`, `wireless`,
`location`, `display`, `sound`, `notifications`, `accessibility`, `usageAccess`,
`notificationListener`, `overlay`, `writeSettings`, `batteryOptimization`,
`unknownSources`, `security`, `privacy`, `vpn`, `nfc`, `language`, `dateTime`,
`keyboard`, `developerOptions`.

### Panels (API 29+)

- `isSettingsPanelSupported(panel: SettingsPanel): boolean`
- `openPanel(panel: SettingsPanel): Promise<boolean>`

Panels: `internet`, `wifi`, `volume`, `nfc`.

### Observer

- `watchSetting(namespace, key): string` (returns `subscriptionId`)
- `unwatchSetting(subscriptionId): void`
- `unwatchAllSettings(): void`

## Events

```ts
const listener = CreepyAndroidSettings.addListener('onSettingChanged', (event) => {
  console.log(event.subscriptionId, event.namespace, event.key, event.value, event.timestamp);
});

const observerId = CreepyAndroidSettings.watchSetting('system', 'screen_brightness');

// later
CreepyAndroidSettings.unwatchSetting(observerId);
listener.remove();
```

The `onSettingChanged` payload is:

```ts
{
  subscriptionId: string;
  namespace: 'system' | 'secure' | 'global';
  key: string;
  value: string | number | null;
  timestamp: number;
}
```

## Examples

```ts
import { CreepyAndroidSettings } from 'creepy-android-settings';

const capabilities = CreepyAndroidSettings.getCapabilities();
console.log(capabilities);

if (!CreepyAndroidSettings.canWriteSystemSettings()) {
  await CreepyAndroidSettings.requestWriteSystemSettingsPermission();
}

if (CreepyAndroidSettings.canWriteSystemSettings()) {
  CreepyAndroidSettings.setScreenBrightnessPercent(50);
}
```

## Error model

All failures are normalized `ERR_*` codes surfaced on the `code` property:

- `ERR_PLATFORM_NOT_SUPPORTED`
- `ERR_INVALID_ARGUMENT`
- `ERR_INVALID_NAMESPACE`
- `ERR_UNKNOWN_SETTINGS_SCREEN`
- `ERR_SETTINGS_SCREEN_UNAVAILABLE`
- `ERR_SETTINGS_PANEL_UNAVAILABLE`
- `ERR_WRITE_SETTINGS_PERMISSION_REQUIRED`
- `ERR_SETTING_READ_FAILED`
- `ERR_SETTING_WRITE_FAILED`
- `ERR_OBSERVER_NOT_FOUND`
- `ERR_ANDROID_CONTEXT_UNAVAILABLE`

## Platform limitations

- **Android-only.** iOS/Web throw `ERR_PLATFORM_NOT_SUPPORTED`.
- **Settings Panels** require API 29+ (`isSettingsPanelSupported` returns
  `false` below that).
- **`notifications` / `unknownSources`** screens require API 26+.
- **OEMs** (Samsung, Xiaomi, OnePlus, …) may alter the Settings UI. Every
  `ACTION_*` intent is checked against the `PackageManager` before launch; an
  unavailable screen yields `ERR_SETTINGS_SCREEN_UNAVAILABLE` instead of a
  crash.

## Security limitations

This module does **not** bypass the Android permission system. It never uses
`root`, `su`, `adb shell`, Shizuku, hidden APIs, `WRITE_SECURE_SETTINGS` hacks
or accessibility tricks. Operations that a normal app cannot perform return a
controlled "unavailable" result. Special permissions are never toggled
automatically — the user must grant them in the Android Settings UI.

## Tests

```bash
cd modules/creepy-android-settings
npx jest
```

Covers brightness conversion, argument validation, screen/panel mapping, web
stub (`ERR_PLATFORM_NOT_SUPPORTED`) and error-code normalization.

## Manual test harness

A development-only screen is available at `app/dev/android-settings.tsx` (route
`/dev/android-settings`). It exercises capabilities, the `WRITE_SETTINGS` flow,
brightness, auto-rotate, screen timeout, navigation, Settings Panels and the
brightness observer.
