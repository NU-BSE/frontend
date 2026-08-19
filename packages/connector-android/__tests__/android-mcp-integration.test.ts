import { InMemoryConnectionStore } from '@mobile-agent/connector-core';
import { AndroidConnector, ANDROID_CONNECTION_ID } from '../src';

import { closeTestRuntimes, makeBridge, startRuntime } from './mcp-test-helpers';

afterEach(async () => {
  await closeTestRuntimes();
});

async function connectAndStart(
  bridge = makeBridge(),
): Promise<{
  runtime: Awaited<ReturnType<typeof startRuntime>>['runtime'];
  approvalService: Awaited<ReturnType<typeof startRuntime>>['approvalService'];
}> {
  const store = new InMemoryConnectionStore();
  const connector = new AndroidConnector({ store, settingsBridge: bridge });
  await connector.connect();
  return startRuntime(connector);
}

async function approveThenCall(
  runtime: Awaited<ReturnType<typeof startRuntime>>['runtime'],
  approvalService: Awaited<ReturnType<typeof startRuntime>>['approvalService'],
  name: string,
  arguments_: Record<string, unknown>,
): Promise<Awaited<ReturnType<typeof runtime.mcp.callTool>>> {
  const first = await runtime.mcp.callTool({ name, arguments: arguments_ });
  const approvalId = (first.structuredContent as { approvalId: string }).approvalId;
  await approvalService.approve(approvalId);
  return runtime.mcp.callTool({
    name,
    arguments: { ...arguments_, approvalId },
  });
}

describe('android.settings tools through the MCP boundary', () => {
  it('open_panel returns success envelope after approval', async () => {
    const openPanel = jest.fn(async () => true);
    const { runtime, approvalService } = await connectAndStart(
      makeBridge({ openPanel }),
    );

    const result = await approveThenCall(
      runtime,
      approvalService,
      'android.settings.open_panel',
      { connectionId: ANDROID_CONNECTION_ID, panel: 'wifi' },
    );

    expect(result.structuredContent).toEqual({
      status: 'success',
      data: { opened: true, panel: 'wifi' },
    });
    expect(openPanel).toHaveBeenCalledWith('wifi');
  });

  it('open_panel with a false native result is a tool error, not success', async () => {
    const { runtime, approvalService } = await connectAndStart(
      makeBridge({ openPanel: async () => false }),
    );

    await expect(
      approveThenCall(runtime, approvalService, 'android.settings.open_panel', {
        connectionId: ANDROID_CONNECTION_ID,
        panel: 'wifi',
      }),
    ).rejects.toThrow(/did not open the "wifi"/);
  });

  it('read tools return data without approval', async () => {
    const { runtime } = await connectAndStart();

    const brightness = await runtime.mcp.callTool({
      name: 'android.settings.get_brightness',
      arguments: { connectionId: ANDROID_CONNECTION_ID },
    });

    expect(brightness.structuredContent).toEqual({
      status: 'success',
      data: { percent: 50, raw: 128 },
    });

    const capabilities = await runtime.mcp.callTool({
      name: 'android.settings.get_capabilities',
      arguments: { connectionId: ANDROID_CONNECTION_ID },
    });
    expect(
      (capabilities.structuredContent as { status: string }).status,
    ).toBe('success');
  });

  it('set_brightness writes through the bridge after approval', async () => {
    const setScreenBrightnessPercent = jest.fn(() => true);
    const { runtime, approvalService } = await connectAndStart(
      makeBridge({ setScreenBrightnessPercent }),
    );

    const result = await approveThenCall(
      runtime,
      approvalService,
      'android.settings.set_brightness',
      { connectionId: ANDROID_CONNECTION_ID, percent: 40 },
    );

    expect(result.structuredContent).toEqual({
      status: 'success',
      data: { percent: 40 },
    });
    expect(setScreenBrightnessPercent).toHaveBeenCalledWith(40);
  });

  it('set_screen_timeout with a false native result is a tool error', async () => {
    const { runtime, approvalService } = await connectAndStart(
      makeBridge({ setScreenTimeout: () => false }),
    );

    await expect(
      approveThenCall(runtime, approvalService, 'android.settings.set_screen_timeout', {
        connectionId: ANDROID_CONNECTION_ID,
        milliseconds: 60000,
      }),
    ).rejects.toThrow(/did not apply/);
  });

  it('set_auto_rotate with a false native result is a tool error', async () => {
    const { runtime, approvalService } = await connectAndStart(
      makeBridge({ setAutoRotate: () => false }),
    );

    await expect(
      approveThenCall(runtime, approvalService, 'android.settings.set_auto_rotate', {
        connectionId: ANDROID_CONNECTION_ID,
        enabled: true,
      }),
    ).rejects.toThrow(/did not apply/);
  });

  it('missing WRITE_SETTINGS returns PERMISSION_REQUIRED, not success', async () => {
    // Grant at connect time so the record carries `android.settings.write`,
    // then revoke it — simulating the user toggling the permission off after
    // connecting. The live native check, not the snapshot scope, must reject.
    let canWrite = true;
    const { runtime, approvalService } = await connectAndStart(
      makeBridge({ canWriteSystemSettings: () => canWrite }),
    );
    canWrite = false;

    await expect(
      approveThenCall(runtime, approvalService, 'android.settings.set_brightness', {
        connectionId: ANDROID_CONNECTION_ID,
        percent: 40,
      }),
    ).rejects.toThrow(/Permission to modify Android system settings is required/);
  });

  it('every production tool is real and no low-level/permission tools are exposed', async () => {
    const { runtime } = await connectAndStart();
    const tools = await runtime.mcp.listTools();
    const androidTools = tools.filter((tool) => tool.name.startsWith('android.'));

    expect(androidTools.length).toBeGreaterThan(0);
    for (const tool of androidTools) {
      expect(tool.name).not.toMatch(/set_system|get_secure|get_global|request_/);
    }
  });
});
