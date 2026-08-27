import type {
  ConnectionRecord,
  ConnectorTool,
  StoreBackedConnectorOptions,
} from '@mobile-agent/connector-core';
import { StoreBackedConnector } from '@mobile-agent/connector-core';

import type { AndroidSettingsBridge } from './android-settings-bridge';
import { createAndroidSettingsTools } from './android-settings-tools';
import { mapAndroidSettingsError } from './android-settings-errors';
import type { AndroidAssistantBridge } from './assistant-bridge';
import { createAssistantTools } from './assistant-tools';
import type { DeviceSignalBridge } from './device-signal-tools';
import { createDeviceSignalTools } from './device-signal-tools';

/** Stable connection id — a device connector never spawns per-connect ids. */
export const ANDROID_CONNECTION_ID = 'android-device';

export interface AndroidConnectorOptions extends StoreBackedConnectorOptions {
  /** Injected by the app layer. Never imported from Expo/RN inside this package. */
  settingsBridge: AndroidSettingsBridge;
  /**
   * Optional: present only in a build carrying the assistant native module.
   * When absent the assistant tools are not registered at all, so the model
   * cannot attempt a capability this build does not have.
   */
  assistantBridge?: AndroidAssistantBridge;
  /**
   * Optional: usage history, the notification shade and media control.
   * Absent in a build without those native modules, in which case the tools
   * are not registered and the model cannot attempt them.
   */
  signalBridge?: DeviceSignalBridge;
}

const CAPABILITIES = [
  'android.settings.read',
  'android.settings.brightness',
  'android.settings.brightness_mode',
  'android.settings.screen_timeout',
  'android.settings.auto_rotate',
  'android.settings.haptic_feedback',
  'android.settings.sound_effects',
  'android.settings.navigation',
  'android.settings.app_navigation',
  'android.apps.read',
];

/**
 * Real on-device Android Settings connector.
 *
 * `partial`: the Settings and app-discovery tools are real, while unrelated
 * Android data surfaces (contacts, calendar, files, notifications content,
 * clipboard, …) are not implemented and therefore are not registered.
 */
export class AndroidConnector extends StoreBackedConnector {
  readonly id = 'android' as const;
  readonly displayName = 'This device';
  readonly implementationStatus = 'partial' as const;

  private readonly settingsBridge: AndroidSettingsBridge;

  private readonly assistantBridge: AndroidAssistantBridge | null;

  private readonly signalBridge: DeviceSignalBridge | null;

  constructor(options: AndroidConnectorOptions) {
    super(options);
    this.settingsBridge = options.settingsBridge;
    this.assistantBridge = options.assistantBridge ?? null;
    this.signalBridge = options.signalBridge ?? null;
  }

  /**
   * Idempotent local connect: no OAuth or account picker. Creates or refreshes
   * the single `android-device` record, preserving `createdAt` and re-reading
   * live permissions so `scopes` always reflect current access.
   */
  async connect(): Promise<ConnectionRecord> {
    try {
      const capabilities = this.settingsBridge.getCapabilities();
      const canWrite = this.settingsBridge.canWriteSystemSettings();
      const canOverlay = this.settingsBridge.canDrawOverlays();

      const now = Date.now();
      const existing = await this.store.get(ANDROID_CONNECTION_ID);

      const scopes = [
        'android.settings.read',
        ...(canWrite ? ['android.settings.write'] : []),
        ...(canOverlay ? ['android.overlay'] : []),
      ];

      const displayName =
        [capabilities.manufacturer, capabilities.model]
          .filter(Boolean)
          .join(' ')
          .trim() || 'Android device';

      const record: ConnectionRecord = {
        id: ANDROID_CONNECTION_ID,
        connectorId: this.id,
        displayName,
        status: 'connected',
        scopes,
        capabilities: CAPABILITIES,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      await this.store.save(record);
      return record;
    } catch (error) {
      throw mapAndroidSettingsError(error, 'connecting this device');
    }
  }

  async getTools(_connection: ConnectionRecord): Promise<ConnectorTool<any, any>[]> {
    return [
      ...createAndroidSettingsTools({ bridge: this.settingsBridge }),
      ...(this.assistantBridge
        ? createAssistantTools({ bridge: this.assistantBridge })
        : []),
      ...(this.signalBridge
        ? createDeviceSignalTools({ bridge: this.signalBridge })
        : []),
    ];
  }
}
