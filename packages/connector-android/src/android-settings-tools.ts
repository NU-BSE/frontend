import * as z from 'zod/v4';
import { ConnectorError, type ConnectorTool } from '@mobile-agent/connector-core';

import type { AndroidSettingsBridge } from './android-settings-bridge';
import { mapAndroidSettingsError } from './android-settings-errors';

/**
 * Agent-facing Settings screens. Permission-granting screens (`overlay`,
 * `writeSettings`, `batteryOptimization`, `unknownSources`) are intentionally
 * excluded: the model must not steer the user through permission escalation —
 * that path is the user's, via Account → Connectors → This device.
 */
const OPEN_SCREENS = [
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
  'usageAccess',
  'notificationListener',
  'security',
  'privacy',
  'vpn',
  'nfc',
  'language',
  'dateTime',
  'keyboard',
  'developerOptions',
] as const;

type OpenScreen = (typeof OPEN_SCREENS)[number];

const OPEN_PANELS = ['internet', 'wifi', 'volume', 'nfc'] as const;

const CONNECTION_ID = z.string().min(1);

const PERMISSION_MESSAGE =
  'Permission to modify Android system settings is required. Enable it in Account → Connectors → This device.';

export interface AndroidSettingsToolsDeps {
  bridge: AndroidSettingsBridge;
}

/**
 * The real, native-backed Android Settings tool set.
 *
 * Every tool is marked `implementationStatus: 'real'` — no fixture is ever
 * returned. Arbitrary `Settings` reads/writes and permission-request tools are
 * deliberately not exposed: the model gets capability-level tools only.
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

  return [
    {
      name: 'android.settings.get_capabilities',
      title: 'Device settings capabilities',
      description:
        'Report this device model and which Android settings capabilities are available.',
      inputSchema: z.object({ connectionId: CONNECTION_ID }),
      outputSchema: z.object({
        apiLevel: z.number(),
        manufacturer: z.string(),
        model: z.string(),
        canWriteSystemSettings: z.boolean(),
        canDrawOverlays: z.boolean(),
        settingsPanelsSupported: z.boolean(),
        supportedScreens: z.record(z.string(), z.boolean()),
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
          };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'reading Android capabilities');
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
          bridge.setScreenBrightnessPercent(input.percent);
          return { percent: input.percent };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'setting screen brightness');
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
          bridge.setScreenTimeout(input.milliseconds);
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
      inputSchema: z.object({
        connectionId: CONNECTION_ID,
        enabled: z.boolean(),
      }),
      outputSchema: z.object({ enabled: z.boolean() }),
      risk: 'write',
      capabilities: ['android.settings.auto_rotate'],
      requiredScopes: ['android.settings.write'],
      implementationStatus: 'real',
      execute: async (input: { connectionId: string; enabled: boolean }) => {
        requireWriteSettings();
        try {
          bridge.setAutoRotate(input.enabled);
          return { enabled: input.enabled };
        } catch (error) {
          throw mapAndroidSettingsError(error, 'setting auto-rotate');
        }
      },
    },

    {
      name: 'android.settings.open',
      title: 'Open Android settings screen',
      description:
        'Open a specific Android system settings screen. Permission screens are not available here.',
      inputSchema: z.object({
        connectionId: CONNECTION_ID,
        screen: z.enum(OPEN_SCREENS),
      }),
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
          await bridge.openSettings(input.screen);
          return { opened: true as const, screen: input.screen };
        } catch (error) {
          throw mapAndroidSettingsError(error, `opening "${input.screen}" settings`);
        }
      },
    },

    {
      name: 'android.settings.open_panel',
      title: 'Open Android settings panel',
      description: 'Open a floating Android Settings Panel (internet, wifi, volume or nfc).',
      inputSchema: z.object({
        connectionId: CONNECTION_ID,
        panel: z.enum(OPEN_PANELS),
      }),
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
          await bridge.openPanel(input.panel);
          return { opened: true as const, panel: input.panel };
        } catch (error) {
          throw mapAndroidSettingsError(error, `opening "${input.panel}" panel`);
        }
      },
    },
  ];
}
