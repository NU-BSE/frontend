import * as z from 'zod/v4';
import { ConnectorError, type ConnectorTool } from '@mobile-agent/connector-core';

import type {
  AndroidSettingsBridge,
  AppSettingsTarget,
  BrightnessMode,
  InstalledAppSummary,
} from './android-settings-bridge';
import { mapAndroidSettingsError } from './android-settings-errors';

/**
 * Agent-facing Settings destinations. Opening any of these screens changes
 * nothing by itself; the user owns the system UI and confirms the action.
 *
 * `writeSettings` and `overlay` are the two exceptions to keeping
 * Creepy-specific grants out of a model-facing list, and they are here for a
 * reason the list itself creates: they gate this connector's own tools, so
 * excluding them leaves the agent able to fail on a missing scope and unable
 * to do anything about it. `SCOPE_REMEDIES` in the app names both by screen,
 * and `verify:agent` asserts every remedy names a screen this list accepts —
 * advice pointing at a door that is not there is worse than no advice.
 *
 * That was not theoretical: asked to dim the screen, the agent failed with
 * "missing required scopes: android.settings.write" and nothing in the app
 * could reach the toggle. The report was "it wasn't prompted and it's not
 * present in permissions".
 *
 * The unknown-sources grant does stay out. It gates nothing this connector
 * does, so there is no failure to recover from, and it is the toggle that
 * permits sideloading. Battery optimization is different again: a normal
 * troubleshooting destination used to review optimization/exemption state, so
 * the agent may open it while the user still decides in Android Settings.
 */
export const OPEN_SCREENS = [
  'settings',
  'settingsSearch',
  'appDetails',
  'wifi',
  'wifiIp',
  'bluetooth',
  'wireless',
  'location',
  'display',
  'sound',
  'notifications',
  'accessibility',
  'assistant',
  'usageAccess',
  'notificationListener',
  /*
   * Special access that gates this connector's own tools. Opening either puts
   * Android's own toggle in front of the user, switched off; nothing is
   * granted here, and nothing can be granted without them acting on it.
   */
  'writeSettings',
  'overlay',
  'batteryOptimization',
  'security',
  'privacy',
  'vpn',
  'nfc',
  'language',
  'dateTime',
  'keyboard',
  'developerOptions',
  'apps',
  'allApps',
  'defaultApps',
  'home',
  'batterySaver',
  'batteryUsage',
  'dataUsage',
  'airplaneMode',
  'apn',
  'roaming',
  'doNotDisturb',
  'doNotDisturbPriority',
  'storage',
  'deviceInfo',
  'systemUpdate',
  'sync',
  'addAccount',
  'userDictionary',
  'hardwareKeyboard',
  'captioning',
  'cast',
  'print',
  'dream',
  'autoRotateSettings',
  'webView',
  'allNotifications',
] as const;

type OpenScreen = (typeof OPEN_SCREENS)[number];

const APP_TARGETS = [
  'appDetails',
  'appNotifications',
  'notificationChannel',
  'notificationBubbles',
  'appOpenByDefault',
  'appLocale',
  'appUsage',
  'backgroundData',
  'exactAlarm',
  'fullScreenIntent',
] as const satisfies readonly AppSettingsTarget[];

const OPEN_PANELS = ['internet', 'wifi', 'volume', 'nfc'] as const;
const CONNECTION_ID = z.string().min(1);

const PACKAGE_NAME = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .describe(
    'Exact Android package id, e.g. "com.google.android.apps.bard". It MUST ' +
      'be a packageName returned by android.apps.find — never a display ' +
      'name like "Gemini" and never invented. If only the app\'s name is ' +
      'known, call android.apps.find with that name first and copy the ' +
      'chosen result\'s packageName verbatim.',
  );

const APP_TARGET_INPUT = z
  .object({
    connectionId: CONNECTION_ID,
    target: z.enum(APP_TARGETS),
    packageName: PACKAGE_NAME,
    channelId: z.string().trim().min(1).max(255).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.target === 'notificationChannel' && !value.channelId) {
      ctx.addIssue({
        code: 'custom',
        path: ['channelId'],
        message: 'channelId is required for notificationChannel settings.',
      });
    }
  });

/**
 * The message for a package that is not on this device.
 *
 * Package ids are not guessable and a model will guess anyway: asked to open
 * Gemini it produced `com.google.android.apps.gemini`, which does not exist —
 * the real one is `com.google.android.apps.bard`. Saying only that something
 * was unavailable sent it looking for the wrong fault; it concluded the
 * *destination* was unsupported, claimed to have opened the app by hand, and
 * announced it would retry with the same invented id.
 *
 * So the error names the actual fault and the tool that fixes it, and lists
 * what is installed under a similar name. The list is a list — nothing is
 * chosen here, because choosing which app the user meant is exactly the
 * decision that must not be made for them.
 */
function unknownPackageError(
  bridge: AndroidSettingsBridge,
  packageName: string,
): ConnectorError {
  // The last segment is the closest thing to an app name a package id
  // carries: `com.google.android.apps.gemini` searches for "gemini".
  const term = packageName.split('.').filter(Boolean).pop() ?? packageName;

  let matches: InstalledAppSummary[] = [];
  try {
    matches = bridge.findApps(term, 5);
  } catch {
    // A failed search must not replace the real error with its own.
  }

  const suggestion = matches.length
    ? ` Installed apps matching "${term}": ${matches
        .map((app) => `${app.label} (${app.packageName})`)
        .join(', ')}.`
    : '';

  return new ConnectorError(
    `No app with package "${packageName}" is installed on this device. ` +
      'Package ids cannot be guessed from an app name — call ' +
      'android.apps.find and copy a packageName from its results.' +
      suggestion,
    'VALIDATION_FAILED',
  );
}

const APP_SUMMARY_SCHEMA = z.object({
  packageName: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  systemApp: z.boolean(),
  launchable: z.boolean(),
});

const APP_INFO_SCHEMA = APP_SUMMARY_SCHEMA.extend({
  versionName: z.string().nullable(),
  versionCode: z.number().int().nullable(),
});

/*
 * In-band backstop for a stale connection record. The primary gate is the MCP
 * scope check (the message there — "missing required scopes: …" — is what the
 * app classifies as PERMISSION_REQUIRED and decorates with a remedy). The
 * same phrasing is reused here so the two layers classify identically: a
 * record that still claims android.settings.write after Android revoked it
 * must read as a permission problem, never as an auth/infrastructure one.
 */
const PERMISSION_MESSAGE =
  'Connection "This device" is missing required scopes: android.settings.write. ' +
  'The user has not granted "Modify system settings" for Creepy on this phone.';

export interface AndroidSettingsToolsDeps {
  bridge: AndroidSettingsBridge;
}

/**
 * Real native-backed Android Settings tools. Arbitrary Settings provider keys
 * are intentionally never model-facing: every read/write below is a narrow,
 * validated capability with a stable semantic contract.
 */
export function createAndroidSettingsTools(
  deps: AndroidSettingsToolsDeps,
): ConnectorTool<any, any>[] {
  const { bridge } = deps;

  const requireWriteSettings = () => {
    if (!bridge.canWriteSystemSettings()) {
      throw new ConnectorError(PERMISSION_MESSAGE, 'PERMISSION_REQUIRED');
    }
  };

  const requireApplied = (applied: boolean, description: string) => {
    if (!applied) {
      throw new ConnectorError(
        `Android did not apply the requested ${description}.`,
        'PROVIDER_ERROR',
      );
    }
  };

  return [
    {
      name: 'android.settings.get_capabilities',
      title: 'Device settings capabilities',
      description:
        'Report this Android device and the Settings destinations available on it.',
      inputSchema: z.object({ connectionId: CONNECTION_ID }),
      outputSchema: z.object({
        apiLevel: z.number(),
        manufacturer: z.string(),
        model: z.string(),
        canWriteSystemSettings: z.boolean(),
        canDrawOverlays: z.boolean(),
        settingsPanelsSupported: z.boolean(),
        supportedScreens: z.record(z.string(), z.boolean()),
        supportedAppTargets: z.record(z.string(), z.boolean()),
      }),
      risk: 'read',
      capabilities: ['android.settings.read'],
      requiredScopes: ['android.settings.read'],
      implementationStatus: 'real',
      execute: async () => {
        try {
          const caps = bridge.getCapabilities();
          return {
            apiLevel: caps.apiLevel,
            manufacturer: caps.manufacturer,
            model: caps.model,
            canWriteSystemSettings: caps.canWriteSystemSettings,
            canDrawOverlays: caps.canDrawOverlays,
            settingsPanelsSupported: caps.settingsPanelsSupported,
            supportedScreens: caps.supportedScreens ?? {},
            supportedAppTargets: caps.supportedAppTargets ?? {},
          };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'reading Android capabilities');
        }
      },
    },

    {
      name: 'android.apps.find',
      title: 'Find installed apps',
      description:
        'Find launchable Android apps by display name or package name. Results respect Android package-visibility rules.',
      inputSchema: z.object({
        connectionId: CONNECTION_ID,
        query: z.string().max(255).default(''),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      outputSchema: z.object({ apps: z.array(APP_SUMMARY_SCHEMA) }),
      risk: 'read',
      capabilities: ['android.apps.read'],
      requiredScopes: ['android.settings.read'],
      implementationStatus: 'real',
      execute: async (input: { connectionId: string; query: string; limit?: number }) => {
        try {
          return { apps: bridge.findApps(input.query, input.limit ?? 20) };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'finding installed Android apps');
        }
      },
    },

    {
      name: 'android.apps.get_info',
      title: 'Get app information',
      description:
        'Read basic package, version, enabled, system-app and launchability information for an Android app visible to this app.',
      inputSchema: z.object({ connectionId: CONNECTION_ID, packageName: PACKAGE_NAME }),
      outputSchema: z.object({ app: APP_INFO_SCHEMA.nullable() }),
      risk: 'read',
      capabilities: ['android.apps.read'],
      requiredScopes: ['android.settings.read'],
      implementationStatus: 'real',
      execute: async (input: { connectionId: string; packageName: string }) => {
        let app;
        try {
          app = bridge.getAppInfo(input.packageName);
        } catch (error) {
          throw mapAndroidSettingsError(error, `reading app info for "${input.packageName}"`);
        }
        /*
         * A missing app is not a successful read.
         *
         * This returned `{ app: null }` and reported success, so the timeline
         * said "android.apps.get_info — done" and the model took its invented
         * package id as confirmed. "Success" and "there is no such app" have
         * to be distinguishable, or every later step is built on the first
         * wrong guess.
         */
        if (!app) throw unknownPackageError(bridge, input.packageName);
        return { app };
      },
    },

    {
      name: 'android.settings.get_brightness',
      title: 'Get screen brightness',
      description: 'Read the current screen brightness (percent and raw 0..255 value).',
      inputSchema: z.object({ connectionId: CONNECTION_ID }),
      outputSchema: z.object({ percent: z.number(), raw: z.number() }),
      risk: 'read',
      capabilities: ['android.settings.read'],
      requiredScopes: ['android.settings.read'],
      implementationStatus: 'real',
      execute: async () => {
        try {
          return {
            percent: bridge.getScreenBrightnessPercent(),
            raw: bridge.getScreenBrightness(),
          };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'reading screen brightness');
        }
      },
    },

    {
      name: 'android.settings.set_brightness',
      title: 'Set screen brightness',
      description:
        'Set screen brightness to a percentage (0..100). If adaptive ' +
        'brightness is on, Creepy switches it to manual first — automatic mode ' +
        'overrides a fixed value — and reports the change. Returns the ' +
        'brightness Android actually reported afterwards, not the requested ' +
        'number.',
      inputSchema: z.object({
        connectionId: CONNECTION_ID,
        percent: z.number().min(0).max(100),
      }),
      outputSchema: z.object({
        percent: z.number(),
        brightnessMode: z.enum(['manual', 'automatic']),
        adaptiveDisabled: z.boolean(),
      }),
      risk: 'write',
      capabilities: ['android.settings.brightness'],
      requiredScopes: ['android.settings.write'],
      implementationStatus: 'real',
      execute: async (input: { connectionId: string; percent: number }) => {
        requireWriteSettings();
        try {
          // Automatic brightness overrides any fixed value Android may accept,
          // so an exact level is only reachable in manual mode. Switching modes
          // is part of the same user-visible action — the approval copy names
          // it — never a silent side effect.
          const modeBefore = bridge.getBrightnessMode();
          let adaptiveDisabled = false;
          if (modeBefore === 'automatic') {
            requireApplied(
              bridge.setBrightnessMode('manual'),
              'switching brightness to manual',
            );
            adaptiveDisabled = true;
          }

          requireApplied(
            bridge.setScreenBrightnessPercent(input.percent),
            'brightness',
          );

          // Read back rather than echoing the request: `putInt` returning true
          // only means the write was accepted, not that the value stuck (OEM
          // brightness managers and HyperOS layers can override it).
          const actual = bridge.getScreenBrightnessPercent();
          if (Math.abs(actual - input.percent) > 5) {
            throw new ConnectorError(
              `Android reported the screen brightness as ${actual}%, not the ` +
                `${input.percent}% requested, so the change did not stick.`,
              'PROVIDER_ERROR',
            );
          }
          return {
            percent: actual,
            brightnessMode: bridge.getBrightnessMode(),
            adaptiveDisabled,
          };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'setting screen brightness');
        }
      },
    },

    {
      name: 'android.settings.get_brightness_mode',
      title: 'Get brightness mode',
      description: 'Read whether Android brightness is manual or automatic.',
      inputSchema: z.object({ connectionId: CONNECTION_ID }),
      outputSchema: z.object({ mode: z.enum(['manual', 'automatic']) }),
      risk: 'read',
      capabilities: ['android.settings.read'],
      requiredScopes: ['android.settings.read'],
      implementationStatus: 'real',
      execute: async () => {
        try {
          return { mode: bridge.getBrightnessMode() };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'reading brightness mode');
        }
      },
    },

    {
      name: 'android.settings.set_brightness_mode',
      title: 'Set brightness mode',
      description:
        'Switch Android screen brightness between manual and automatic mode. ' +
        'Reports the mode Android actually holds afterwards.',
      inputSchema: z.object({
        connectionId: CONNECTION_ID,
        mode: z.enum(['manual', 'automatic']),
      }),
      outputSchema: z.object({ mode: z.enum(['manual', 'automatic']) }),
      risk: 'write',
      capabilities: ['android.settings.brightness_mode'],
      requiredScopes: ['android.settings.write'],
      implementationStatus: 'real',
      execute: async (input: { connectionId: string; mode: BrightnessMode }) => {
        requireWriteSettings();
        try {
          requireApplied(bridge.setBrightnessMode(input.mode), 'brightness mode');
          return { mode: bridge.getBrightnessMode() };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'setting brightness mode');
        }
      },
    },

    {
      name: 'android.settings.get_screen_timeout',
      title: 'Get screen timeout',
      description: 'Read the current screen-off timeout in milliseconds.',
      inputSchema: z.object({ connectionId: CONNECTION_ID }),
      outputSchema: z.object({ milliseconds: z.number() }),
      risk: 'read',
      capabilities: ['android.settings.read'],
      requiredScopes: ['android.settings.read'],
      implementationStatus: 'real',
      execute: async () => {
        try {
          return { milliseconds: bridge.getScreenTimeout() };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'reading screen timeout');
        }
      },
    },

    {
      name: 'android.settings.set_screen_timeout',
      title: 'Set screen timeout',
      description: 'Set the screen-off timeout in milliseconds (0 = never).',
      inputSchema: z.object({
        connectionId: CONNECTION_ID,
        milliseconds: z.number().int().min(0),
      }),
      outputSchema: z.object({ milliseconds: z.number() }),
      risk: 'write',
      capabilities: ['android.settings.screen_timeout'],
      requiredScopes: ['android.settings.write'],
      implementationStatus: 'real',
      execute: async (input: { connectionId: string; milliseconds: number }) => {
        requireWriteSettings();
        try {
          requireApplied(bridge.setScreenTimeout(input.milliseconds), 'screen timeout');
          return { milliseconds: bridge.getScreenTimeout() };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'setting screen timeout');
        }
      },
    },

    {
      name: 'android.settings.get_auto_rotate',
      title: 'Get auto-rotate',
      description: 'Read whether auto-rotate is enabled.',
      inputSchema: z.object({ connectionId: CONNECTION_ID }),
      outputSchema: z.object({ enabled: z.boolean() }),
      risk: 'read',
      capabilities: ['android.settings.read'],
      requiredScopes: ['android.settings.read'],
      implementationStatus: 'real',
      execute: async () => {
        try {
          return { enabled: bridge.getAutoRotate() };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'reading auto-rotate');
        }
      },
    },

    {
      name: 'android.settings.set_auto_rotate',
      title: 'Set auto-rotate',
      description: 'Enable or disable auto-rotate.',
      inputSchema: z.object({ connectionId: CONNECTION_ID, enabled: z.boolean() }),
      outputSchema: z.object({ enabled: z.boolean() }),
      risk: 'write',
      capabilities: ['android.settings.auto_rotate'],
      requiredScopes: ['android.settings.write'],
      implementationStatus: 'real',
      execute: async (input: { connectionId: string; enabled: boolean }) => {
        requireWriteSettings();
        try {
          requireApplied(bridge.setAutoRotate(input.enabled), 'auto-rotate setting');
          return { enabled: bridge.getAutoRotate() };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'setting auto-rotate');
        }
      },
    },

    {
      name: 'android.settings.get_haptic_feedback',
      title: 'Get haptic feedback',
      description: 'Read whether system haptic feedback is enabled.',
      inputSchema: z.object({ connectionId: CONNECTION_ID }),
      outputSchema: z.object({ enabled: z.boolean() }),
      risk: 'read',
      capabilities: ['android.settings.read'],
      requiredScopes: ['android.settings.read'],
      implementationStatus: 'real',
      execute: async () => {
        try {
          return { enabled: bridge.getHapticFeedbackEnabled() };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'reading haptic feedback');
        }
      },
    },

    {
      name: 'android.settings.set_haptic_feedback',
      title: 'Set haptic feedback',
      description: 'Enable or disable system haptic feedback.',
      inputSchema: z.object({ connectionId: CONNECTION_ID, enabled: z.boolean() }),
      outputSchema: z.object({ enabled: z.boolean() }),
      risk: 'write',
      capabilities: ['android.settings.haptic_feedback'],
      requiredScopes: ['android.settings.write'],
      implementationStatus: 'real',
      execute: async (input: { connectionId: string; enabled: boolean }) => {
        requireWriteSettings();
        try {
          requireApplied(bridge.setHapticFeedbackEnabled(input.enabled), 'haptic feedback setting');
          return { enabled: bridge.getHapticFeedbackEnabled() };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'setting haptic feedback');
        }
      },
    },

    {
      name: 'android.settings.get_sound_effects',
      title: 'Get system sound effects',
      description: 'Read whether Android system sound effects are enabled.',
      inputSchema: z.object({ connectionId: CONNECTION_ID }),
      outputSchema: z.object({ enabled: z.boolean() }),
      risk: 'read',
      capabilities: ['android.settings.read'],
      requiredScopes: ['android.settings.read'],
      implementationStatus: 'real',
      execute: async () => {
        try {
          return { enabled: bridge.getSoundEffectsEnabled() };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'reading system sound effects');
        }
      },
    },

    {
      name: 'android.settings.set_sound_effects',
      title: 'Set system sound effects',
      description: 'Enable or disable Android system sound effects.',
      inputSchema: z.object({ connectionId: CONNECTION_ID, enabled: z.boolean() }),
      outputSchema: z.object({ enabled: z.boolean() }),
      risk: 'write',
      capabilities: ['android.settings.sound_effects'],
      requiredScopes: ['android.settings.write'],
      implementationStatus: 'real',
      execute: async (input: { connectionId: string; enabled: boolean }) => {
        requireWriteSettings();
        try {
          requireApplied(bridge.setSoundEffectsEnabled(input.enabled), 'system sound effects setting');
          return { enabled: bridge.getSoundEffectsEnabled() };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'setting system sound effects');
        }
      },
    },

    {
      name: 'android.settings.open',
      title: 'Open Android settings screen',
      description:
        'Open an allow-listed global Android Settings destination. Use ' +
        'batteryUsage for battery-use details, batteryOptimization for ' +
        'optimization exemptions, wifiIp for Wi-Fi IP configuration, ' +
        'doNotDisturbPriority for priority-mode rules, and settingsSearch ' +
        'when Android exposes no stable direct destination for an OEM-specific setting.',
      inputSchema: z.object({ connectionId: CONNECTION_ID, screen: z.enum(OPEN_SCREENS) }),
      outputSchema: z.object({ opened: z.literal(true), screen: z.string() }),
      risk: 'external_side_effect',
      capabilities: ['android.settings.navigation'],
      requiredScopes: [],
      implementationStatus: 'real',
      execute: async (input: { connectionId: string; screen: OpenScreen }) => {
        try {
          if (!bridge.canOpenSettings(input.screen)) {
            throw new ConnectorError(
              `The "${input.screen}" settings screen is unavailable on this device.`,
              'UNSUPPORTED',
            );
          }
          const opened = await bridge.openSettings(input.screen);
          if (!opened) {
            throw new ConnectorError(
              `Android did not open the "${input.screen}" settings screen.`,
              'PROVIDER_ERROR',
            );
          }
          return { opened: true as const, screen: input.screen };
        } catch (error) {
          throw mapAndroidSettingsError(error, `opening "${input.screen}" settings`);
        }
      },
    },

    {
      name: 'android.settings.open_app',
      title: 'Open settings for an app',
      description:
        'Open one app\'s Android Settings destination. Use appDetails as the ' +
        'safe public fallback for permissions, Force stop, cache/storage, ' +
        'uninstall/disable and OEM-specific app battery controls; the USER ' +
        'must tap those controls. Use appNotifications or notificationChannel ' +
        'for alerts, exactAlarm for Android 12+ exact-alarm access, and ' +
        'fullScreenIntent for Android 14+ full-screen notification access.',
      inputSchema: APP_TARGET_INPUT,
      outputSchema: z.object({
        opened: z.literal(true),
        target: z.enum(APP_TARGETS),
        packageName: z.string(),
        channelId: z.string().optional(),
      }),
      risk: 'external_side_effect',
      capabilities: ['android.settings.app_navigation'],
      requiredScopes: [],
      implementationStatus: 'real',
      execute: async (input: {
        connectionId: string;
        target: AppSettingsTarget;
        packageName: string;
        channelId?: string;
      }) => {
        try {
          // Before the destination is blamed for a package that is not there:
          // "App Details is not available for this app" is what the model was
          // told, and it means something quite different from "no such app".
          if (!bridge.getAppInfo(input.packageName)) {
            throw unknownPackageError(bridge, input.packageName);
          }
          if (!bridge.canOpenAppSettings(input.target, input.packageName, input.channelId)) {
            throw new ConnectorError(
              `The "${input.target}" settings destination is unavailable for ${input.packageName} on this device.`,
              'UNSUPPORTED',
            );
          }
          const opened = await bridge.openAppSettings(
            input.target,
            input.packageName,
            input.channelId,
          );
          if (!opened) {
            throw new ConnectorError(
              `Android did not open "${input.target}" for ${input.packageName}.`,
              'PROVIDER_ERROR',
            );
          }
          return {
            opened: true as const,
            target: input.target,
            packageName: input.packageName,
            ...(input.channelId ? { channelId: input.channelId } : {}),
          };
        } catch (error) {
          throw mapAndroidSettingsError(
            error,
            `opening "${input.target}" for ${input.packageName}`,
          );
        }
      },
    },

    {
      name: 'android.settings.open_panel',
      title: 'Open Android settings panel',
      description: 'Open a floating Android Settings Panel (internet, wifi, volume or nfc).',
      inputSchema: z.object({ connectionId: CONNECTION_ID, panel: z.enum(OPEN_PANELS) }),
      outputSchema: z.object({ opened: z.literal(true), panel: z.string() }),
      risk: 'external_side_effect',
      capabilities: ['android.settings.navigation'],
      requiredScopes: [],
      implementationStatus: 'real',
      execute: async (input: { connectionId: string; panel: (typeof OPEN_PANELS)[number] }) => {
        try {
          if (!bridge.isSettingsPanelSupported(input.panel)) {
            throw new ConnectorError(
              `The "${input.panel}" settings panel is unavailable on this device.`,
              'UNSUPPORTED',
            );
          }
          const opened = await bridge.openPanel(input.panel);
          if (!opened) {
            throw new ConnectorError(
              `Android did not open the "${input.panel}" settings panel.`,
              'PROVIDER_ERROR',
            );
          }
          return { opened: true as const, panel: input.panel };
        } catch (error) {
          throw mapAndroidSettingsError(error, `opening "${input.panel}" panel`);
        }
      },
    },
  ];
}
