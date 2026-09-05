# @mobile-agent/connector-android

Real on-device **Android Settings and app-discovery** connector for Creepy.IM.

The package is platform-neutral: it depends only on the `AndroidSettingsBridge`
contract. The app layer injects the real Expo/Kotlin bridge from
`src/connections/android/settings-native-bridge.ts`, so Node verification can
import this package without loading React Native or Expo.

## Connection lifecycle

`connect()` is a local, idempotent operation with no OAuth flow. It maintains a
single stable connection:

- id: `android-device`
- display name: manufacturer + model from native capabilities
- scopes: `android.settings.read`, plus `android.settings.write` and
  `android.overlay` when those user-granted special accesses are currently on
- capabilities include typed Settings reads/writes, global and per-app Settings
  navigation, Settings Panels and installed-app metadata

The runtime auto-connects this local connector when the native Android bridge
exists. On web, iOS and Node the connector is omitted rather than mocked.

## MCP tools

### Device and installed apps

- `android.settings.get_capabilities`
- `android.apps.find`
- `android.apps.get_info`

App discovery uses Android's launcher visibility query. It deliberately does
**not** request `QUERY_ALL_PACKAGES`; results therefore respect Android package
visibility and are limited to apps visible through the launcher query.

### Typed Settings reads/writes

- `android.settings.get_brightness`
- `android.settings.set_brightness`
- `android.settings.get_brightness_mode`
- `android.settings.set_brightness_mode`
- `android.settings.get_screen_timeout`
- `android.settings.set_screen_timeout`
- `android.settings.get_auto_rotate`
- `android.settings.set_auto_rotate`
- `android.settings.get_haptic_feedback`
- `android.settings.set_haptic_feedback`
- `android.settings.get_sound_effects`
- `android.settings.set_sound_effects`

Every setter performs a live `Settings.System.canWrite()` check. The persisted
connection scope is only a snapshot; it is not used as the security boundary.

Arbitrary provider keys such as `setSystemInt(key, value)`, generic
`Settings.Secure`/`Settings.Global` access and permission-request functions are
not exposed as MCP tools. The agent receives narrow typed capabilities only.

### Global Settings navigation

`android.settings.open` opens an allow-listed global Settings destination. The
registry covers Wi-Fi/Bluetooth/networking, location, display and sound,
notifications, accessibility, assistant/default-app selection, privacy and
security, apps/default apps, Battery Saver, battery-usage details, battery
optimization, data usage, airplane/APN/roaming, Do Not Disturb and priority
rules, storage, device info/system update, accounts/sync, language/input,
captioning, cast, print, screensaver, auto-rotate, WebView and all-app
notification settings where the device/API supports them.

Guide-focused additions include:

- `batteryUsage` — Android's power-usage summary
- `batteryOptimization` — battery-optimization/exemption management
- `wifiIp` — Wi-Fi IP configuration
- `doNotDisturbPriority` — Do Not Disturb priority rules
- `settingsSearch` — Android Settings search as the safe fallback when no
  stable public destination exists for an OEM-specific setting

The model-facing list intentionally excludes Creepy's own `writeSettings` and
`overlay` grant screens and the unknown-sources grant. Those stay in the
user-owned connector/setup flow. Opening any allowed destination grants
nothing; the user still owns the Settings UI and confirms the change.

`assistant` opens the public Default apps destination on Android 7+ (or the
applications settings fallback on older Android). It no longer uses
`ACTION_VOICE_INPUT_SETTINGS`, which configures voice input methods rather than
the default digital assistant. When the user wants to make Creepy the assistant,
`android.assistant.request_role` remains the preferred RoleManager flow.

### Per-app Settings navigation

`android.settings.open_app` takes an explicit `packageName` and one of:

- `appDetails`
- `appNotifications`
- `notificationChannel` (`channelId` required)
- `notificationBubbles`
- `appOpenByDefault`
- `appLocale`
- `appUsage`
- `backgroundData`
- `exactAlarm` (Android 12 / API 31+)
- `fullScreenIntent` (Android 14 / API 34+)

`appDetails` is the deliberate public fallback for app controls Android does
not expose as third-party callable operations, including permissions, Force
stop, cache/storage reset, uninstall/disable and many OEM-specific app battery
controls. Creepy can take the user to App info and explain the next tap, but it
does not pretend that an ordinary app can silently perform those protected
operations on another app.

### Settings Panels

`android.settings.open_panel` supports `internet`, `wifi`, `volume` and `nfc`
on Android 10 / API 29+ when the panel resolves on the current device.

## Security model

The connector uses ordinary Android framework APIs and resolvable Settings
intents. It does not use root, `su`, adb, Shizuku, reflection into hidden APIs,
`WRITE_SECURE_SETTINGS`, accessibility automation or OEM private activity class
names. Two long-standing top-level Settings action strings that are present in
the framework but absent from the compile SDK are still resolved defensively at
runtime; unsupported OEM builds report the destination unavailable rather than
fake success. `Settings.Secure` and `Settings.Global` writes are not exposed.

## Guide coverage and limitations

See [`SETTINGS_COVERAGE.md`](./SETTINGS_COVERAGE.md) for the 36 creepy.im Android
guide scenarios and the MCP destination/fallback used for each one.

The important limitation is intentional: Android does not publish stable
third-party intents or APIs for every UI leaf. Notification history,
power-button gestures, Wi-Fi QR sharing/hotspot setup, Bluetooth forget/pair,
Force stop/clear-data actions, Work Profile pause and many OEM-specific battery
or permission pages therefore use the nearest stable Settings screen plus
step-by-step guidance. They are not represented as fake direct capabilities.

Other known limitations:

- Android-only; the connector is not registered when the native bridge is absent.
- OEM Settings apps may omit or redirect framework destinations, so availability
  is resolved before launch.
- App lookup obeys Android package visibility and is not an unrestricted package
  inventory.
- Android data/content surfaces such as contacts, files, notification contents
  and clipboard are separate capabilities and are not implemented here.

## Tests

```bash
npm run --workspace packages/connector-android typecheck
npx jest --config packages/connector-android/jest.config.cjs
```
