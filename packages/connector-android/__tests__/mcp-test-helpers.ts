import {
  type ConnectionRecord,
  type Connector,
  type ConnectorId,
  type ConnectorTool,
} from '@mobile-agent/connector-core';
import { ConnectorRegistry } from '@mobile-agent/connector-registry';
import { DefaultPolicyEngine } from '@mobile-agent/policy-core';
import { InMemoryApprovalService } from '@mobile-agent/approval-core';
import { InMemoryApprovalStore, MockCalendarConnector } from '@mobile-agent/connector-mock';
import { createLocalMcpRuntime, type LocalMcpRuntime } from '@mobile-agent/mcp-client';

import type { AndroidSettingsBridge } from '../src';

export function makeBridge(
  overrides: Partial<AndroidSettingsBridge> = {},
): AndroidSettingsBridge {
  return {
    getCapabilities: () => ({
      platform: 'android',
      apiLevel: 36,
      manufacturer: 'samsung',
      model: 'SM-S928B',
      canWriteSystemSettings: true,
      canDrawOverlays: false,
      settingsPanelsSupported: true,
      supportedScreens: { wifi: true, bluetooth: true },
      supportedAppTargets: { appDetails: true, appNotifications: true },
    }),
    canWriteSystemSettings: () => true,
    requestWriteSystemSettingsPermission: async () => true,
    canDrawOverlays: () => false,
    requestOverlayPermission: async () => false,
    getScreenBrightness: () => 128,
    getScreenBrightnessPercent: () => 50,
    setScreenBrightness: () => true,
    setScreenBrightnessPercent: () => true,
    getScreenTimeout: () => 30000,
    setScreenTimeout: () => true,
    getAutoRotate: () => false,
    setAutoRotate: () => true,
    getBrightnessMode: () => 'automatic',
    setBrightnessMode: () => true,
    getHapticFeedbackEnabled: () => true,
    setHapticFeedbackEnabled: () => true,
    getSoundEffectsEnabled: () => true,
    setSoundEffectsEnabled: () => true,
    canOpenSettings: () => true,
    openSettings: async () => true,
    canOpenAppSettings: () => true,
    openAppSettings: async () => true,
    isSettingsPanelSupported: () => true,
    openPanel: async () => true,
    findApps: () => [
      {
        packageName: 'org.telegram.messenger',
        label: 'Telegram',
        enabled: true,
        systemApp: false,
        launchable: true,
      },
    ],
    getAppInfo: () => ({
      packageName: 'org.telegram.messenger',
      label: 'Telegram',
      versionName: '12.0',
      versionCode: 12000,
      enabled: true,
      systemApp: false,
      launchable: true,
    }),
    ...overrides,
  };
}

export function fakeConnector(
  connectorId: ConnectorId,
  tools: ConnectorTool[],
  connection: ConnectionRecord,
): Connector {
  return {
    id: connectorId,
    displayName: 'Fake',
    implementationStatus: 'partial',
    async listConnections() {
      return [connection];
    },
    async getConnection(id) {
      return id === connection.id ? connection : null;
    },
    async getTools() {
      return tools;
    },
    async disconnect() {},
  };
}

export interface TestRuntime {
  runtime: LocalMcpRuntime;
  approvalService: InMemoryApprovalService;
}

const openRuntimes: LocalMcpRuntime[] = [];

export async function closeTestRuntimes(): Promise<void> {
  const runtimes = openRuntimes.splice(0);
  await Promise.all(runtimes.map((runtime) => runtime.close()));
}

export async function startRuntime(connector: Connector): Promise<TestRuntime> {
  const registry = new ConnectorRegistry({ allowDevelopmentMocks: true });
  registry.register(connector);

  const approvalService = new InMemoryApprovalService();
  const runtime = await createLocalMcpRuntime(
    {
      calendar: new MockCalendarConnector(),
      approvals: new InMemoryApprovalStore(),
    },
    {
      registry,
      policyEngine: new DefaultPolicyEngine(),
      approvalService,
    },
    { builtInCalendar: false },
  );
  openRuntimes.push(runtime);

  return { runtime, approvalService };
}
