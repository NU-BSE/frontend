# @mobile-agent/connector-android

Real on-device **Android Settings** connector for Creepy.IM.

This package exposes the Android device as an MCP connector backed by the
`creepy-android-settings` Expo native module. It replaces the earlier mock
connector: no fixture data, no fake successes.

## Architecture

```
Creepy.IM Agent
      ↓
Local MCP Runtime
      ↓
AndroidConnector (this package)
      ↓
AndroidSettingsBridge (interface in this package)
      ↓
creepy-android-settings (Expo native module, Android/Kotlin)
      ↓
android.provider.Settings
```

The package itself is **platform-neutral**: it only knows the
`AndroidSettingsBridge` interface and small pure TypeScript DTO types. The real
`creepy-android-settings → AndroidSettingsBridge` adapter lives in the app
layer (`src/connections/android/settings-native-bridge.ts`) and is injected
into `AndroidConnector` at registry construction. This package never imports
Expo, React Native, or the native module, so it stays importable from Node
verification scripts, Jest and `tsc`.

## Native bridge

`AndroidSettingsBridge` (see `src/android-settings-bridge.ts`) is the seam. The
app supplies it via `getAndroidSettingsBridge()`:

```ts
new AndroidConnector({ store, settingsBridge });
```

If no bridge is available (web, iOS, Node, or a build without the native
module), the Android connector is **not registered** — there is never a fake
connector or a fake `connected` connection.

## Connection lifecycle

`connect()` is a local, idempotent operation — no OAuth, no account picker. It
creates or refreshes a single stable connection:

- id: `android-device` (never regenerated)
- `displayName`: from `getCapabilities()` (`manufacturer model`)
- `scopes`: always `android.settings.read`, plus `android.settings.write` and
  `android.overlay` when those permissions are currently granted
- preserves `createdAt`, updates `updatedAt`

`disconnect()` removes the record via the shared `ConnectionStore`. It does
**not** revoke Android system permissions — those live in Android Settings.

## Settings MCP tools

| Tool | Risk | Capability | Requires WRITE_SETTINGS |
| --- | --- | --- | --- |
| `android.settings.get_capabilities` | read | `android.settings.read` | no |
| `android.settings.get_brightness` | read | `android.settings.read` | no |
| `android.settings.set_brightness` | write | `android.settings.brightness` | yes |
| `android.settings.get_screen_timeout` | read | `android.settings.read` | no |
| `android.settings.set_screen_timeout` | write | `android.settings.screen_timeout` | yes |
| `android.settings.get_auto_rotate` | read | `android.settings.read` | no |
| `android.settings.set_auto_rotate` | write | `android.settings.auto_rotate` | yes |
| `android.settings.open` | external_side_effect | `android.settings.navigation` | no |
| `android.settings.open_panel` | external_side_effect | `android.settings.navigation` | no |

Every tool is marked `implementationStatus: 'real'`.

Deliberately **not exposed** to the model:

- arbitrary `Settings` writes (`setSystemInt`, `setSystemString`, …) and
  arbitrary reads (`getSetting(namespace, key)`) — the model gets
  capability-level tools only;
- permission-request tools (`requestWriteSystemSettingsPermission`,
  `requestOverlayPermission`) — special Android permissions are granted by the
  user through Account → Connectors → This device, never by the agent.

## Permission model

- `WRITE_SETTINGS` gates every write tool. Each write performs a **live**
  `canWriteSystemSettings()` check before calling the bridge — the persisted
  `ConnectionRecord.scopes` is a snapshot, not a security boundary. When the
  permission is missing the tool returns `PERMISSION_REQUIRED`.
- `Overlay` (`canDrawOverlays`) is optional and does not gate the settings
  tools.

## Error mapping

Native `ERR_*` codes are mapped to `ConnectorError` in
`src/android-settings-errors.ts`; raw Kotlin messages are sanitized and never
reach the model.

## Security restrictions

No root, `su`, `adb`, Shizuku, hidden APIs, `WRITE_SECURE_SETTINGS` hacks or
accessibility tricks. `Settings.Secure` and `Settings.Global` writes are never
exposed. If an operation is not permitted to a normal app, the tool reports
`UNSUPPORTED` or `PERMISSION_REQUIRED`.

## Known limitations

- Android-only; on other platforms the connector is not registered.
- Settings Panels require API 29+.
- The remaining Android surface (contacts, calendar, files, notifications,
  clipboard, …) is not implemented and therefore not registered — the previous
  mocks were removed, not promoted.

## Tests

```bash
npm run --workspace packages/connector-android typecheck
npx jest --config packages/connector-android/jest.config.cjs
```
