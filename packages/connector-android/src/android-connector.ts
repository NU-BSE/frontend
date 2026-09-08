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

const ASSISTANT_CAPABILITIES = [
  'android.assistant.read',
  'android.assistant.manage',
  'android.assistant.screen_context',
];

/**
 * Device-signal capabilities (usage history, the notification shade, media
 * control). The tools are registered whenever the signal bridge exists; the
 * *scopes* below are granted only when the matching Android access is live.
 */
const SIGNAL_CAPABILITIES = [
  'android.usage.read',
  'android.notifications.read',
  'android.notifications.reply',
  'android.media.read',
  'android.media.control',
];

export interface AndroidScopeInput {
  canWrite: boolean;
  canOverlay: boolean;
  assistantBridgePresent: boolean;
  signalBridgePresent: boolean;
  usageGranted: boolean;
  notificationsGranted: boolean;
}

/**
 * The scopes a fresh `connect()` should write onto the device connection.
 *
 * Pure and exported so the grant logic is unit-testable without a connector.
 * The read scope is unconditional (ordinary apps may read Settings); every
 * other scope is granted only when the matching live Android access exists.
 * Media control depends on Notification Listener access on Android, so its
 * scopes follow the notification grant rather than being independent.
 */
export function computeAndroidScopes(input: AndroidScopeInput): string[] {
  const assistant = input.assistantBridgePresent ? ASSISTANT_CAPABILITIES : [];
  const media = input.notificationsGranted
    ? ['android.media.read', 'android.media.control']
    : [];
  return [
    'android.settings.read',
    ...assistant,
    ...(input.canWrite ? ['android.settings.write'] : []),
    ...(input.canOverlay ? ['android.overlay'] : []),
    ...(input.usageGranted ? ['android.usage.read'] : []),
    ...(input.notificationsGranted
      ? ['android.notifications.read', 'android.notifications.reply']
      : []),
    ...media,
  ];
}

/**
 * The capabilities a fresh `connect()` should advertise.
 *
 * Capabilities describe what the tools *can* do when the matching native
 * bridge exists — not whether the user has granted access. Tools are
 * registered whenever the bridge exists, so the capabilities match the
 * registered tool list.
 */
export function computeAndroidCapabilities(input: {
  assistantBridgePresent: boolean;
  signalBridgePresent: boolean;
}): string[] {
  return [
    ...CAPABILITIES,
    ...(input.assistantBridgePresent ? ASSISTANT_CAPABILITIES : []),
    ...(input.signalBridgePresent ? SIGNAL_CAPABILITIES : []),
  ];
}

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

      /*
       * Usage and notification access are granted on their own system screens
       * and report nothing back, so the only source of truth is a live
       * re-check. Media control rides on notification access. Without these
       * grants the matching MCP tools are advertised but rejected at the scope
       * gate with PERMISSION_REQUIRED (plus a remedy) — the same contract the
       * write-settings scope uses.
       */
      const [usageGranted, notificationsGranted] = await Promise.all([
        this.signalBridge ? this.signalBridge.usage.hasPermission() : false,
        this.signalBridge
          ? this.signalBridge.notifications.hasPermission()
          : false,
      ]);

      const now = Date.now();
      const existing = await this.store.get(ANDROID_CONNECTION_ID);

      const scopes = computeAndroidScopes({
        canWrite,
        canOverlay,
        assistantBridgePresent: this.assistantBridge != null,
        signalBridgePresent: this.signalBridge != null,
        usageGranted,
        notificationsGranted,
      });

      const recordCapabilities = computeAndroidCapabilities({
        assistantBridgePresent: this.assistantBridge != null,
        signalBridgePresent: this.signalBridge != null,
      });

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
        capabilities: recordCapabilities,
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
