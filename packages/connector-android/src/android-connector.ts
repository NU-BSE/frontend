import type {
  ConnectionRecord,
  ConnectorTool,
  StoreBackedConnectorOptions,
} from '@mobile-agent/connector-core';
import { StoreBackedConnector } from '@mobile-agent/connector-core';

import type { AndroidSettingsBridge } from './android-settings-bridge';
import { createAndroidSettingsTools } from './android-settings-tools';
import { mapAndroidSettingsError } from './android-settings-errors';

/** Stable connection id — a device connector never spawns per-connect ids. */
export const ANDROID_CONNECTION_ID = 'android-device';

export interface AndroidConnectorOptions extends StoreBackedConnectorOptions {
  /** Injected by the app layer. Never imported from Expo/RN inside this package. */
  settingsBridge: AndroidSettingsBridge;
}

const CAPABILITIES = [
  'android.settings.read',
  'android.settings.brightness',
  'android.settings.screen_timeout',
  'android.settings.auto_rotate',
  'android.settings.navigation',
];

/**
 * Real on-device Android Settings connector.
 *
 * `partial`: the Settings tools are real (backed by the native Expo module),
 * while the rest of the Android surface (contacts, calendar, files, …) is not
 * implemented and is therefore not registered at all — it can never report a
 * fixture success in production.
 */
export class AndroidConnector extends StoreBackedConnector {
  readonly id = 'android' as const;
  readonly displayName = 'This device';
  readonly implementationStatus = 'partial' as const;

  private readonly settingsBridge: AndroidSettingsBridge;

  constructor(options: AndroidConnectorOptions) {
    super(options);
    this.settingsBridge = options.settingsBridge;
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
    return createAndroidSettingsTools({ bridge: this.settingsBridge });
  }
}
