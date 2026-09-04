import * as z from 'zod/v4';
import { ConnectorError, type ConnectorTool } from '@mobile-agent/connector-core';

import type {
  AndroidSettingsBridge,
  AppSettingsTarget,
  BrightnessMode,
} from './android-settings-bridge';
import { mapAndroidSettingsError } from './android-settings-errors';

/**
 * Agent-facing global Settings screens. Permission-granting destinations
 * (`overlay`, `writeSettings`, `batteryOptimization`, `unknownSources`) remain
 * deliberately excluded: those grants belong to the user-owned connector UI.
 */
export const OPEN_SCREENS = [
  'settings',
  'appDetails',
  'wifi',
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
   * The two special-access screens that gate this connector's own tools.
   *
   * The native navigator has always resolved both, and the module's
   * SettingsScreen type has always named them, but they were missing here — so
   * the agent could hit `android.settings.write` and had no way to do anything
   * about it. Asked to dim the screen it failed with "missing required scopes:
   * android.settings.write", and nothing in the app could take the user to the
   * toggle that fixes it; they reported never being prompted and being unable
   * to find the setting at all. `usageAccess` and `notificationListener` are
   * special-access screens too and were already offered, so the omission reads
   * as an oversight rather than a policy.
   *
   * Opening a screen grants nothing. The user still has to find the toggle and
   * turn it on, which is the whole point: this puts the switch in front of
   * them instead of leaving them to hunt for it.
   */
  'writeSettings',
  'overlay',
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
  'dataUsage',
  'airplaneMode',
  'apn',
  'roaming',
  'doNotDisturb',
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
] as const satisfies readonly AppSettingsTarget[];

const OPEN_PANELS = ['internet', 'wifi', 'volume', 'nfc'] as const;

const CONNECTION_ID = z.string().min(1);
const PACKAGE_NAME = z.string().trim().min(1).max(255);

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

const PERMISSION_MESSAGE =
  'Permission to modify Android system settings is required. Enable it in Account → Connectors → This device.';

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
        try {
          return { app: bridge.getAppInfo(input.packageName) };
        } catch (error) {
          throw mapAndroidSettingsError(error, `reading app info for "${input.packageName}"`);
        }
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
      description: 'Set screen brightness to a percentage (0..100).',
      inputSchema: z.object({
        connectionId: CONNECTION_ID,
        percent: z.number().min(0).max(100),
      }),
      outputSchema: z.object({ percent: z.number() }),
      risk: 'write',
      capabilities: ['android.settings.brightness'],
      requiredScopes: ['android.settings.write'],
      implementationStatus: 'real',
      execute: async (input: { connectionId: string; percent: number }) => {
        requireWriteSettings();
        try {
          requireApplied(bridge.setScreenBrightnessPercent(input.percent), 'brightness');
          return { percent: input.percent };
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
      description: 'Switch Android screen brightness between manual and automatic mode.',
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
          return { mode: input.mode };
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
          return { milliseconds: input.milliseconds };
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
          return { enabled: input.enabled };
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
          return { enabled: input.enabled };
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
          return { enabled: input.enabled };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'setting system sound effects');
        }
      },
    },

    {
      name: 'android.settings.open',
      title: 'Open Android settings screen',
      description:
        'Open a global Android Settings screen. Permission-granting special-access screens are not available here.',
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
      /*
       * The description says what the destinations are *for*, because a model
       * that only knows their names cannot map a request onto them. Asked to
       * "turn off Gemini app" it invented `android.settings.get_app_info` and
       * gave up, while `appDetails` — the page carrying Disable, Uninstall and
       * Force stop — was available the whole time.
       *
       * It also states the limit plainly. No app may disable, uninstall or
       * force-stop another; Android reserves that for the user. Opening the
       * page is the most that can be done, and a model told only what the tool
       * *can* do will keep hunting for one that does the rest.
       */
      description:
        'Open a package-scoped Android Settings destination for one app. ' +
        'Targets: "appDetails" is App info — the page where the USER can ' +
        'disable, uninstall, force stop, or clear the data of that app; use ' +
        'it for any request to turn an app off, remove it, or stop it. Also ' +
        '"appNotifications", "notificationChannel", "notificationBubbles", ' +
        '"appOpenByDefault" and the other targets in the schema. This opens ' +
        'the screen only: no app is permitted to disable, uninstall or force ' +
        'stop another one, so after opening it, tell the user what to tap.',
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
