# Android Native Capability Audit & Hardening

Audit of every Android-native-backed capability in Creepy.IM, the fresh-install
permission/special-access gap, and the fixes applied.

Protected regressions (must remain intact):

* `784cba5` — foreground gate, live WRITE_SETTINGS scope refresh, error
  classification fix, agent pause while backgrounded.
* `08adc996` — `writeSettings`/`overlay` reachable through
  `android.settings.open` so SCOPE_REMEDIES advice names a real screen.

---

## 1. Native module inventory

Every module below has its Kotlin implementation **in this repo** and is
registered into the Android release build (`android/app/src/main/...` +
`MainApplication.kt`), except where flagged.

| Capability | JS surface | Kotlin implementation | Registration | Android access | Status |
|---|---|---|---|---|---|
| Android Settings read/write/navigate | `CreepyAndroidSettings` (Expo module, `requireOptionalNativeModule`) | `modules/creepy-android-settings/android/.../CreepyAndroidSettingsModule.kt` + Reader/Writer/Navigator/Observer/Errors | Expo autolinking (`expo-module.config.json`) → `ExpoModulesPackage` | `WRITE_SETTINGS` (write), `SYSTEM_ALERT_WINDOW` (overlay) | ✅ linked |
| Usage history | `UsageStats` (`getNativeModule`) | `src/usage/native/.../UsageStatsModule.kt` | `UsagePackage` in MainApplication (via `with-device-signals.js`) | `PACKAGE_USAGE_STATS` app-op (signature) | ✅ linked |
| Notification shade read/reply | `NotificationReader` (`getNativeModule`) | `src/notifications/reader/native/.../NotificationReaderModule.kt` + `NotificationReaderService.kt` (`NotificationListenerService`) | `NotificationReaderPackage` + service declared | `BIND_NOTIFICATION_LISTENER_SERVICE` binding (user grant) | ✅ linked |
| Media transport | `MediaControl` (`getNativeModule`) | `src/media/native/.../MediaControlModule.kt` | `MediaPackage` in MainApplication | `MEDIA_CONTENT_CONTROL` + **Notification Listener** (session enumeration) | ✅ linked |
| Assistant role + screen context | `AssistantRole` (`NativeModules.AssistantRole`) | `src/assistant/native/.../AssistantRoleModule.kt` + 3 services | `AssistantPackage` + 3 services declared (via `with-assistant.js`) | `ROLE_ASSISTANT` (RoleManager / Default-apps) | ✅ linked |
| Voice (STT/TTS) | `SpeechRecognition` / `CreepyTextToSpeech` | `src/voice/native/.../SpeechRecognitionModule.kt`, `TextToSpeechModule.kt` | `VoicePackage` in MainApplication | `RECORD_AUDIO` runtime | ✅ linked |
| Smart cards / approvals | `SmartCards` | `src/notifications/native/.../SmartCardsModule.kt` + Receiver | `SmartCardsPackage` + receiver | `POST_NOTIFICATIONS` (Android 13+) | ✅ linked |
| Google auth | `GoogleAuthorizationModule` | `src/connections/google/native/.../GoogleAuthorizationModule.kt` | `GoogleAuthorizationPackage` | Play Services | ✅ linked |
| Attestation probes | `AttestationNativeProbes` | `src/attestation/native/.../AttestationNativeProbesModule.kt` | `AttestationNativeProbesPackage` | none | ✅ linked |
| Telegram TDLib | `TdLibModule` (`NativeModules.TdLibModule`) | **NOT in repo** — `node_modules/react-native-tdlib` | `TdLibPackage` via `with-tdlib.js` | none (own login) | ⚠ external dep (registered manually) |
| DeviceKey (licensing) | none | `src/licensing/native/.../DeviceKeyModule.kt` | **not registered, no JS consumer** | n/a | ⚠ orphan/dead |
| Flashlight / torch | **none** | **none** | — | — | not implemented (no product expectation) |

## 2. Permission / capability matrix

| Access | Type | Grant flow | Detect state | Open system UI | Foreground re-read | MCP scope | Tool | Failure behavior |
|---|---|---|---|---|---|---|---|---|
| Modify system settings | Special access | Android `ACTION_MANAGE_WRITE_SETTINGS` | `Settings.System.canWrite` | ✅ `writeSettings` | ✅ `useLocalDeviceConnectionSync` + `useAndroidDeviceAccess` | `android.settings.write` | 7 write tools + `android.settings.open` | `PERMISSION_REQUIRED` + remedy (`writeSettings`) |
| Display over other apps | Special access | Android `ACTION_MANAGE_OVERLAY_PERMISSION` | `Settings.canDrawOverlays` | ✅ `overlay` | ✅ same | `android.overlay` | (no tool today) | `PERMISSION_REQUIRED` + remedy (`overlay`) |
| Usage access | App-op | `ACTION_USAGE_ACCESS_SETTINGS` | AppOps `GET_USAGE_STATS` | ✅ `usageAccess` | ✅ `useDeviceSignalAccess` + connection sync | `android.usage.read` | `android.usage.recent` | `PERMISSION_REQUIRED` + remedy (`usageAccess`) |
| Notification access | Service binding | `ACTION_NOTIFICATION_LISTENER_SETTINGS` | Secure `enabled_notification_listeners` + `isConnected` | ✅ `notificationListener` | ✅ same | `android.notifications.read`/`.reply` | `android.notifications.list`/`.reply` | `PERMISSION_REQUIRED` + remedy (`notificationListener`) |
| Media control | Depends on Notification Listener | via Notification access | `MediaSessionManager.getActiveSessions` (null when no access) | ✅ `notificationListener` | live per call | `android.media.read`/`.control` | `android.media.now_playing`/`.control` | `PERMISSION_REQUIRED` + remedy (`notificationListener`) |
| Assistant role | Role | RoleManager dialog / Default-apps | `RoleManager.isRoleHeld` (or Secure) | ✅ `assistant` + `android.assistant.open_settings` | ✅ role re-read on return + foreground gate | `android.assistant.*` | 4 tools | honest `declined`/`unavailable` |
| Microphone | Runtime | `RECORD_AUDIO` dialog | `checkSelfPermission` | n/a | n/a | n/a | none (voice UI) | `VOICE_NO_PERMISSION` |

## 3. Root causes found

1. **Device-signal MCP tools were unreachable.** `AndroidConnector.connect()`
   granted only `android.settings.read/write`, overlay and assistant scopes —
   never `android.usage.read`, `android.notifications.read/reply`,
   `android.media.read/control`. The MCP scope gate rejected every
   usage/notification/media call with "missing required scopes" even after the
   user granted the access; the graceful `hasPermission()` paths inside the
   tools were dead code. **The whole Usage/Notification/Media feature set was
   silently non-functional through the agent.**
2. **Stale package tests contradicted the protected fixes and were never run.**
   `android-connector.test.ts` asserted `writeSettings`/`overlay` are rejected by
   `android.settings.open` (the pre-`08adc996` behavior) and used a static
   read-back bridge; neither the connector-android nor the
   creepy-android-settings Jest suites were in `npm run verify`, so the drift
   went unnoticed (task #21).
3. **Brightness reported success without a read-back and ignored adaptive
   mode.** `set_brightness` echoed the requested number and never handled
   `SCREEN_BRIGHTNESS_MODE=AUTOMATIC`, which overrides a fixed value. On
   HyperOS an accepted `putInt` can also fail to stick.
4. **In-band WRITE_SETTINGS error classified as infrastructure.** The stale
   `PERMISSION_MESSAGE` ("Permission to modify Android system settings is
   required…") did not match `/missing required scopes/`, so the backstop
   (scope still present on a stale record but Android revoked) classified as
   `TOOL_EXECUTION_ERROR` instead of `PERMISSION_REQUIRED`.
5. **No remediation path for signal scopes.** `SCOPE_REMEDIES` covered only
   `android.settings.write` and `android.overlay`; a usage/notification/media
   permission failure gave the agent no "open this screen" advice.
6. **Assistant native source drifted from the build copy.** `src/assistant/...`
   opened `ACTION_VOICE_INPUT_SETTINGS`; the committed `android/` copy uses
   `ACTION_MANAGE_DEFAULT_APPS_SETTINGS` (+ fallback). The next `expo prebuild`
   would have reverted the working behavior.
7. **Native-module availability was indistinguishable from "no permission".**
   `lazyNativeModule` cached `null` with no way to tell "module not linked in
   this build" from "platform unsupported" (task #12/#13).

## 4. Code changes

| File | Change |
|---|---|
| `packages/connector-android/src/android-connector.ts` | `connect()` now samples live usage + notification access and grants `android.usage.read`, `android.notifications.read/reply`, `android.media.read/control` (media only when the listener grant exists). New pure `computeAndroidScopes`/`computeAndroidCapabilities`; signal capabilities advertised when the bridge exists. |
| `packages/connector-android/src/android-settings-tools.ts` | `set_brightness` switches to manual mode when adaptive is on (reported, never silent), reads back the actual brightness, fails honestly if it did not stick (≥5% delta). `set_brightness_mode`/`set_screen_timeout`/`set_auto_rotate`/`set_haptic_feedback`/`set_sound_effects` read back the actual state instead of echoing input. In-band WRITE_SETTINGS message now contains `missing required scopes: android.settings.write` so it classifies as `PERMISSION_REQUIRED`. |
| `src/agent/toolExecutor.ts` | `SCOPE_REMEDIES` for `android.usage.read` → `usageAccess`, and `android.notifications.read/reply` + `android.media.read/control` → `notificationListener`. |
| `src/features/approvals/approvalText.ts` | Brightness approval discloses "Adaptive brightness — switched off if it is on, to hold this level". |
| `src/assistant/native/kotlin/.../AssistantRoleModule.kt` | Synced to the build copy (`ACTION_MANAGE_DEFAULT_APPS_SETTINGS` + `ACTION_APPLICATION_SETTINGS` fallback) so prebuild cannot regress it. |
| `src/native/lazyNativeModule.ts` | Added `getNativeModuleDiagnostics()` distinguishing `AVAILABLE` / `MODULE_NOT_LINKED` / `PLATFORM_UNSUPPORTED` while keeping the cache. |
| `src/connections/android/nativeModulesHealth.ts` | New aggregated health reporter for all expected Android modules (module linked vs reason) + live signal grant state. |
| `src/connections/android/useAssistantAccess.ts` | New hook: live assistant role state, foreground re-read, request/open. |
| `app/connect/android.tsx` | "Digital assistant" row; "Native modules missing from this build" warning. |
| `app/onboarding/connections.tsx` | "Set up device access" entry (→ `/connect/android`) once This device is connected. |
| `app/dev/android-settings.tsx` | Dev harness now shows native-module health + usage/notification/media/assistant gauges. |
| `package.json` | `verify:android-modules` (+ module + connector Jest suites) appended to `npm run verify`. |
| Tests | New `scope-grants`, `settings-write-readback`, `lazyNativeModule`, `toolExecutor` tests; fixed the two stale connector tests to match `08adc996` and the read-back contract. |

## 5. Native module health

All expected modules have in-repo Kotlin and are linked via `MainApplication`
(legacy RN packages) or Expo autolinking (`CreepyAndroidSettings`).
`TdLibModule` is the one module whose Android source is external
(`react-native-tdlib`) but it is registered manually and resolves at runtime.
`DeviceKeyModule.kt` is orphaned (no JS consumer, not registered). No module
required by the feature set is silently missing; `nativeModulesHealth.ts`
makes a future missing module explicit (`MODULE_NOT_LINKED`) in diagnostics.

## 6. Tests added

| Test | Protects against |
|---|---|
| `scope-grants.test.ts` | Signal scopes granted only from live access; media scopes follow notification grant; assistant scopes follow bridge presence. |
| `settings-write-readback.test.ts` | Brightness: adaptive-mode disable, read-back result, honest failure on OEM override. |
| `android-connector.test.ts` (updated) | `08adc996` (writeSettings/overlay openable), read-back contract for writes, stateful bridge. |
| `android-mcp-integration.test.ts` (updated) | MCP boundary brightness + PERMISSION_REQUIRED text. |
| `lazyNativeModule.test.ts` | `AVAILABLE` vs `MODULE_NOT_LINKED` vs cache. |
| `toolExecutor.test.ts` | Signal-scope errors classify `PERMISSION_REQUIRED` (not auth); every signal scope has a remedy screen. |

## 7. POCO X7 Pro / HyperOS manual acceptance checklist

Device not available in this environment — physical verification required.

Record before testing: `get_capabilities` (manufacturer=POCO, model=X7 Pro,
apiLevel), HyperOS version, app build/version.

**A. Native health** — open `/dev/android-settings`, expect every module row
"linked", no `MODULE_NOT_LINKED`.

**B. Fresh-install WRITE_SETTINGS** — ask Creepy "Set brightness to 25%".
Expect: no fake success; `PERMISSION_REQUIRED`; advice to open
`android.settings.open {screen:"writeSettings"}`; HyperOS "Modify system
settings" screen opens.

**C. Grant & return** — toggle on, return. Expect connection scopes gain
`android.settings.write` without restart; retry succeeds.

**D. Brightness** — 25/50/100% with adaptive off, then on. Expect read-back
matches and `adaptiveDisabled` reported when auto was on.

**E. Other writes** — auto-rotate, screen timeout, brightness mode.

**F. Denial flow** — do not grant; return. Expect capability stays
unavailable, no success, no loop, retry available later.

**G. Flashlight** — not implemented; nothing to test.

**H. Usage** — before/after grant, open `usageAccess`, return, `android.usage.recent`.

**I. Notifications** — before/after grant, receive a notification, list/read,
revoke, verify immediate state change.

**J. Media** — with an active session; missing notification access must be
reported, not silent.

**K. Assistant** — status, request, deny/dismiss, request again, grant, return,
role refresh.

**L. Restart** — force-close, reopen; states derived correctly, no stale
scopes, no re-request of already-granted access.

## 8. Remaining limitations (explicit)

* **Flashlight is NOT a capability.** No Kotlin, no JS, no manifest
  permission, no product/agent copy promise it. We did not add a half
  implementation (which would have required assessing the torch API +
  `CAMERA`/`FLASHLIGHT` permission). It stays removed.
* **HyperOS OEM behavior.** Exact brightness can be overridden by Xiaomi
  display managers even after a successful write; the tool now reads back and
  reports honestly, but the *value the OS actually renders on screen* cannot
  be guaranteed through public APIs.
* **Media depends on Notification Listener.** `MediaSessionManager
  .getActiveSessions` requires the listener grant; this dependency is now
  explicit in scopes, remedies and the account screen.
* **Assistant role on MIUI/HyperOS.** `RoleManager` availability and the
  Default-apps landing vary by version; denial is reported honestly, but the
  exact system screen is OEM-controlled.
* **Android instrumentation tests** do not exist in the repo; behavior that
  only a device can prove (HyperOS brightness, real notification binding)
  still needs the physical checklist above.
* **Android APK/AAB compile** was not run in this environment (no SDK
  available); the Kotlin change (assistant sync) is a copy of the already-built
  `android/` source, and every JS/TS change is covered by typecheck + tests.