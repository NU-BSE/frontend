# creepy-android-settings

Android-only Expo native module for Creepy.IM. It exposes the ordinary public
Android APIs used by the local MCP connectors: typed `Settings.System`
operations, Settings navigation, app lookup, Settings Panels and a constrained
set of outward Android intents.

On iOS and web every public method fails with the normalized
`ERR_PLATFORM_NOT_SUPPORTED` error.

## Permissions and package visibility

The module declares `android.permission.WRITE_SETTINGS` and
`android.permission.SYSTEM_ALERT_WINDOW`. Both are special accesses controlled
by the user in Android Settings; the module never grants them itself.

Installed-app discovery does **not** request `QUERY_ALL_PACKAGES`. The manifest
only declares the standard launcher intent query, so `findApps()` is limited to
launchable apps visible under Android package-visibility rules.

## Settings provider

Trusted app code retains low-level reads for `Settings.System`,
`Settings.Secure` and `Settings.Global`, and limited `Settings.System` writes.
Ordinary Android apps cannot arbitrarily write Secure/Global settings, so no
such write API is provided.

Model-facing MCP code does not receive the generic provider-key functions; it
uses typed capabilities instead.

## Typed high-level settings

- screen brightness, raw and percent
- manual/automatic brightness mode
- screen timeout
- auto-rotate
- haptic feedback
- system sound effects

Writes require live `Settings.System.canWrite(context)` permission.

## Global Settings navigation

`canOpenSettings(screen)` and `openSettings(screen)` support the original
Settings destinations plus public Android screens for:

- application management, all apps, default apps and Home selection
- Battery Saver
- data usage, airplane mode, APNs and roaming
- Do Not Disturb
- storage
- device info and system update
- account/sync screens
- user dictionary and hardware keyboard
- captioning, Cast and Print
- screensaver, auto-rotate and WebView selection
- all-app notification settings on supported API levels

Availability is checked through `PackageManager.resolveActivity()` before any
activity is launched. No OEM private activity class names are used.

## Per-app Settings navigation

`canOpenAppSettings(target, packageName, channelId?)` and
`openAppSettings(...)` target an explicit application package. Supported
targets are:

- `appDetails`
- `appNotifications`
- `notificationChannel` — requires `channelId`
- `notificationBubbles`
- `appOpenByDefault`
- `appLocale`
- `appUsage`
- `backgroundData`

The native implementation passes the official package URI or extras required
by each Android `Settings.ACTION_*` contract. The legacy parameterless
`appDetails` screen remains for direct callers and points to Creepy.IM itself;
agent code should use the package-aware API.

## Installed applications

- `findApps(query, limit?)` — searches launcher-visible apps by label/package
- `getAppInfo(packageName)` — returns basic label, version, enabled/system and
  launchability metadata when the package is visible

## Settings Panels

API 29+ panels:

- `internet`
- `wifi`
- `volume`
- `nfc`

## Outward intents

The module backs the real `@mobile-agent/connector-intents` package with narrow
functions rather than a generic arbitrary-Intent API:

- open an allow-listed URI (`http`, `https`, `mailto`, `tel`, `geo`)
- launch an installed package
- share text
- share a `content://` or `android.resource://` file
- open an email composer
- open a map query/coordinate
- open the phone dialer

These operations use public Android intents and return `false` when no
compatible activity can be launched.

## Observer

`watchSetting(namespace, key)` continues to expose a `ContentObserver`-backed
change stream via `onSettingChanged`. Call `unwatchSetting` or
`unwatchAllSettings` when finished.

## Security limitations

No root, `su`, adb, Shizuku, hidden APIs, `WRITE_SECURE_SETTINGS` tricks or
accessibility automation are used. Special permissions are never toggled
programmatically. Unsupported actions fail cleanly.

## Tests

```bash
cd modules/creepy-android-settings
npx jest
```

The development harness remains available at `/dev/android-settings` in native
Android development builds.
