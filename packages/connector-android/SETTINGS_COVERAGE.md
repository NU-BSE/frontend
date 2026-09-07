# Android guide → Settings MCP coverage

This is the audit map for the 36 Android troubleshooting prompts surfaced by
`src/features/scenarios/androidGuides.ts`.

The status labels are deliberately strict:

- **Direct** — Android exposes a stable framework Settings destination or panel
  for the relevant screen.
- **Direct + guided** — Creepy can open the right stable area, but the final
  setting is a user-owned toggle/sub-page inside Settings.
- **Guided fallback** — Android exposes no stable third-party destination for
  the exact UI leaf. Creepy opens the nearest stable screen (or Settings search)
  and guides the remaining taps.

A protected Android action is never called “direct” merely because Settings can
perform it. Ordinary apps cannot silently Force stop another app, clear another
app's storage, grant/revoke another app's runtime permissions, pause a managed
Work Profile, or drive OEM-private Settings activities. Those remain user
confirmed.

| # | Guide scenario | Coverage | MCP route |
|---:|---|---|---|
| 1 | Stop one app from sending notifications | Direct | `android.apps.find` → `android.settings.open_app(appNotifications)`; channel-specific control can use `notificationChannel` |
| 2 | Silence an app at night without muting everything | Direct + guided | `appNotifications` / `notificationChannel`, plus `android.settings.open(doNotDisturb)` or `doNotDisturbPriority` for system focus rules |
| 3 | Notifications not showing | Direct + guided | `appNotifications`, `allNotifications`/`notifications`, and `appDetails` for app-level checks |
| 4 | Find a dismissed notification | Guided fallback | `notifications` or `settingsSearch`; Android publishes no stable Notification history intent |
| 5 | Let one app bypass Do Not Disturb | Direct + guided | `notificationChannel` plus `doNotDisturbPriority` |
| 6 | Fix notification sounds or vibration | Direct + guided | `notificationChannel` / `appNotifications`, `sound`; typed system haptic/sound-effect tools remain available for the corresponding global settings |
| 7 | Turn off Gemini as Android assistant | Direct + guided | find Gemini package if app settings are needed; `assistant` / `android.assistant.open_settings` opens Default apps so the user can change the digital assistant |
| 8 | Change default digital assistant | Direct + guided | `assistant`; when making Creepy the assistant, use `android.assistant.request_role` for the RoleManager consent flow |
| 9 | Stop Gemini opening from the power button | Guided fallback | `settingsSearch` (or `settings`) because power-button/gesture Settings are OEM-specific and have no stable public Settings intent |
| 10 | See which apps used camera, mic or location | Direct + guided | `privacy` opens Android privacy controls/dashboard area; exact layout remains version/OEM dependent |
| 11 | Stop one app tracking location in background | Guided fallback | `appDetails` → user opens Permissions/Location; Android has no stable general per-app runtime-permission Settings intent |
| 12 | Disable camera or microphone access for an app | Guided fallback | `appDetails` → user opens Permissions; no fake programmatic permission revocation is exposed |
| 13 | Find the app responsible for battery drain | Direct | `batteryUsage` opens Android's power-usage summary |
| 14 | Battery drain after an update | Direct + guided | `batteryUsage`, `systemUpdate`, optionally `batterySaver` while troubleshooting |
| 15 | Stop an app running in the background | Guided fallback | `appDetails` for Battery/background controls; `backgroundData` is only for background mobile-data restriction and is not misrepresented as process control |
| 16 | Turn on Adaptive Battery / battery optimization | Direct + guided | `batteryOptimization`; `batterySaver` where appropriate. Adaptive Battery naming/location remains OEM/version specific |
| 17 | Make a low battery last | Direct | `batterySaver` |
| 18 | Phone getting hot / reduce battery drain | Direct + guided | `batteryUsage` and `batterySaver`; Android exposes no universal thermal-settings destination |
| 19 | Storage full / free space | Direct | `storage`; app-specific inspection via `appDetails` |
| 20 | Clear cache vs clear storage | Guided fallback | `appDetails` → Storage & cache; clearing another app's cache/data is a protected user action |
| 21 | App keeps crashing | Direct + guided | `appDetails`, `systemUpdate`; user-owned Force stop/cache/storage/reinstall steps remain guided |
| 22 | Force stop an app | Guided fallback | `appDetails`; Force stop is intentionally not exposed as a callable MCP mutation |
| 23 | Find and remove unused apps | Direct + guided | `allApps`/`apps`, `storage`, `appDetails`; `settingsSearch` covers OEM “Unused apps” surfaces |
| 24 | Phone keeps restarting or freezing | Direct + guided | `systemUpdate`, `storage`, and guided Safe mode/restart diagnostics; Safe mode has no Settings deep link |
| 25 | Wi-Fi connected but no internet | Direct | `open_panel(internet)` / `open_panel(wifi)`, `wifi`, and `wifiIp` for IP configuration |
| 26 | Wi-Fi keeps disconnecting / reset the right settings | Direct + guided | `wifi`, `wireless`, `settingsSearch`; exact network-reset UI is OEM/version dependent |
| 27 | Share Wi-Fi password with QR code | Direct + guided | `wifi`; the QR/share affordance is inside the current Wi-Fi UI and has no stable standalone intent |
| 28 | Bluetooth won't connect | Direct | `bluetooth` |
| 29 | Forget and re-pair a Bluetooth device | Direct + guided | `bluetooth`; forgetting/pairing a chosen accessory stays user-confirmed in system UI |
| 30 | Turn phone into a Wi-Fi hotspot | Guided fallback | `wireless`, internet panel, or `settingsSearch`; Android publishes no stable general hotspot/tether Settings action across OEMs |
| 31 | Make text bigger | Direct + guided | `display`; exact text-size sub-page varies by version/OEM |
| 32 | Turn on screen magnification | Direct + guided | `accessibility`; exact magnification sub-page varies by version/OEM |
| 33 | Alarm didn't go off | Direct + guided | alarm app `appDetails`, `exactAlarm` on API 31+, `fullScreenIntent` on API 34+, plus `sound`/volume panel |
| 34 | Change alarm/ring/media/notification volume separately | Direct | `open_panel(volume)` and `sound` |
| 35 | Pause Android Work Profile after hours | Guided fallback | `settingsSearch` plus instructions. Work Profile pause is policy/OEM managed and has no stable third-party Settings destination |
| 36 | Change default browser | Direct + guided | `defaultApps`; `appOpenByDefault` can open a specific browser's link-handling page on supported Android versions |

## Native/MCP destinations added by this audit

Global screens:

- `settingsSearch` → `Settings.ACTION_APP_SEARCH_SETTINGS` (API 29+)
- `wifiIp` → `Settings.ACTION_WIFI_IP_SETTINGS`
- `batteryUsage` → `Intent.ACTION_POWER_USAGE_SUMMARY`
- `doNotDisturbPriority` → `Settings.ACTION_ZEN_MODE_PRIORITY_SETTINGS` (API 26+)
- `batteryOptimization` was already native-backed and is now model-facing

Per-app screens:

- `exactAlarm` → `Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM` with `package:` URI (API 31+)
- `fullScreenIntent` → `Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT` with `package:` URI (API 34+)

The assistant mapping was also corrected: `assistant` now opens the public Default
apps destination instead of `ACTION_VOICE_INPUT_SETTINGS` (which is for voice
input methods). `ROLE_ASSISTANT` requests still go through RoleManager and the
system-owned consent dialog.

Every native destination is checked with `PackageManager.resolveActivity()`
before launch. An OEM that does not implement a destination therefore reports
it unsupported instead of producing fake success.
