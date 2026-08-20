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

`android.settings.open` opens an allow-listed global Settings destination.
Alongside the original Wi-Fi, Bluetooth, location, display, sound, security,
privacy, VPN, NFC, language, date/time, keyboard and developer screens, the
connector now includes public Android destinations for applications, default
apps/home, Battery Saver, data usage, airplane/APN/roaming, Do Not Disturb,
storage, device info/system update, accounts/sync, user dictionary/hardware
keyboard, captions, cast, print, screensaver, auto-rotate, WebView and the
all-app notifications list when supported by the device/API level.

Special-access grant screens (`overlay`, `writeSettings`,
`batteryOptimization`, `unknownSources`) remain excluded from the model-facing
allowlist. Those grants belong to the user-owned Account → Connectors → This
device flow.

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

This fixes the former ambiguity where `appDetails` was hard-wired to Creepy.IM's
own package. The native layer now passes the package URI or Android extras that
each official `Settings.ACTION_*` contract requires.

### Settings Panels

`android.settings.open_panel` supports `internet`, `wifi`, `volume` and `nfc`
on Android 10 / API 29+ when the panel resolves on the current device.

## Security model

The connector uses ordinary public Android APIs only. It does not use root,
`su`, adb, Shizuku, hidden APIs, `WRITE_SECURE_SETTINGS`, accessibility tricks
or OEM private activity class names. `Settings.Secure` and `Settings.Global`
writes are not exposed. Unsupported or rejected operations return controlled
connector errors instead of fake success.

## Known limitations

- Android-only; the connector is not registered when the native bridge is absent.
- OEM Settings apps may omit or redirect some public `Settings.ACTION_*`
  destinations, so availability is resolved before launch.
- App lookup obeys Android package visibility and is not an unrestricted package
  inventory.
- Android data/content surfaces such as contacts, files, notification contents
  and clipboard are separate capabilities and are not implemented here.

## Tests

```bash
npm run --workspace packages/connector-android typecheck
npx jest --config packages/connector-android/jest.config.cjs
```
