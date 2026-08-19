import {
  InMemoryConnectionStore,
  ConnectorError,
  type ConnectionRecord,
} from '@mobile-agent/connector-core';

import {
  ANDROID_CONNECTION_ID,
  AndroidConnector,
  createAndroidSettingsTools,
  mapAndroidSettingsError,
  type AndroidSettingsBridge,
} from '../src';

function makeBridge(
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
    canOpenSettings: () => true,
    openSettings: async () => true,
    isSettingsPanelSupported: () => true,
    openPanel: async () => true,
    ...overrides,
  };
}

function makeConnector(
  bridge: AndroidSettingsBridge,
  store = new InMemoryConnectionStore(),
): AndroidConnector {
  return new AndroidConnector({ store, settingsBridge: bridge });
}

function executeTool(
  tools: ReturnType<typeof createAndroidSettingsTools>,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool.execute(input, {
    taskId: 'task-1',
    agentId: 'agent-1',
    connection: {
      id: ANDROID_CONNECTION_ID,
      connectorId: 'android',
      displayName: 'samsung SM-S928B',
      status: 'connected',
      scopes: ['android.settings.read', 'android.settings.write'],
      capabilities: [],
      createdAt: 0,
      updatedAt: 0,
    },
    idempotencyKey: 'idem-1',
  });
}

describe('AndroidConnector.connect', () => {
  it('creates a single android-device connection', async () => {
    const store = new InMemoryConnectionStore();
    const connector = makeConnector(makeBridge(), store);

    const record = await connector.connect();

    expect(record.id).toBe(ANDROID_CONNECTION_ID);
    expect(record.connectorId).toBe('android');
    expect(record.status).toBe('connected');
    expect(record.displayName).toBe('samsung SM-S928B');
    expect(record.scopes).toContain('android.settings.read');
    expect(record.scopes).toContain('android.settings.write');
    expect(record.scopes).not.toContain('android.overlay');
  });

  it('is idempotent and preserves createdAt', async () => {
    const store = new InMemoryConnectionStore();
    const connector = makeConnector(makeBridge(), store);

    const first = await connector.connect();
    const second = await connector.connect();

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect((await store.list()).length).toBe(1);
  });

  it('reflects live permissions in scopes', async () => {
    const store = new InMemoryConnectionStore();
    const connector = makeConnector(
      makeBridge({
        canWriteSystemSettings: () => false,
        canDrawOverlays: () => true,
      }),
      store,
    );

    const record = await connector.connect();

    expect(record.scopes).toEqual(['android.settings.read', 'android.overlay']);
  });

  it('reports implementationStatus partial', () => {
    expect(makeConnector(makeBridge()).implementationStatus).toBe('partial');
  });
});

describe('AndroidConnector tools', () => {
  it('get_brightness reads from the bridge', async () => {
    const bridge = makeBridge();
    const connector = makeConnector(bridge);
    const tools = await connector.getTools({} as ConnectionRecord);

    const output = (await executeTool(tools, 'android.settings.get_brightness', {
      connectionId: ANDROID_CONNECTION_ID,
    })) as { percent: number; raw: number };

    expect(output).toEqual({ percent: 50, raw: 128 });
  });

  it('set_brightness writes through the bridge', async () => {
    const setBrightness = jest.fn(() => true);
    const bridge = makeBridge({ setScreenBrightnessPercent: setBrightness });
    const tools = createAndroidSettingsTools({ bridge });

    const output = (await executeTool(tools, 'android.settings.set_brightness', {
      connectionId: ANDROID_CONNECTION_ID,
      percent: 40,
    })) as { percent: number };

    expect(setBrightness).toHaveBeenCalledWith(40);
    expect(output).toEqual({ percent: 40 });
  });

  it('set_auto_rotate writes through the bridge', async () => {
    const setAutoRotate = jest.fn(() => true);
    const bridge = makeBridge({ setAutoRotate });
    const tools = createAndroidSettingsTools({ bridge });

    const output = (await executeTool(tools, 'android.settings.set_auto_rotate', {
      connectionId: ANDROID_CONNECTION_ID,
      enabled: true,
    })) as { enabled: boolean };

    expect(setAutoRotate).toHaveBeenCalledWith(true);
    expect(output).toEqual({ enabled: true });
  });

  it('rejects missing WRITE_SETTINGS with PERMISSION_REQUIRED', async () => {
    const bridge = makeBridge({ canWriteSystemSettings: () => false });
    const tools = createAndroidSettingsTools({ bridge });

    await expect(
      executeTool(tools, 'android.settings.set_brightness', {
        connectionId: ANDROID_CONNECTION_ID,
        percent: 50,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
  });

  it('validates brightness range in the schema', async () => {
    const tools = createAndroidSettingsTools({ bridge: makeBridge() });
    const tool = tools.find((candidate) => candidate.name === 'android.settings.set_brightness');
    if (!tool) throw new Error('tool not found');

    expect(
      tool.inputSchema.safeParse({ connectionId: 'x', percent: 101 }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({ connectionId: 'x', percent: 0 }).success,
    ).toBe(true);
    expect(
      tool.inputSchema.safeParse({ connectionId: 'x', percent: 100 }).success,
    ).toBe(true);
  });

  it('validates timeout range in the schema', async () => {
    const tools = createAndroidSettingsTools({ bridge: makeBridge() });
    const tool = tools.find((candidate) => candidate.name === 'android.settings.set_screen_timeout');
    if (!tool) throw new Error('tool not found');

    expect(
      tool.inputSchema.safeParse({ connectionId: 'x', milliseconds: -1 }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({ connectionId: 'x', milliseconds: 30000 }).success,
    ).toBe(true);
  });

  it('open screen allowlist rejects permission screens', async () => {
    const tools = createAndroidSettingsTools({ bridge: makeBridge() });
    const tool = tools.find((candidate) => candidate.name === 'android.settings.open');
    if (!tool) throw new Error('tool not found');

    expect(
      tool.inputSchema.safeParse({ connectionId: 'x', screen: 'wifi' }).success,
    ).toBe(true);
    expect(
      tool.inputSchema.safeParse({ connectionId: 'x', screen: 'writeSettings' }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({ connectionId: 'x', screen: 'overlay' }).success,
    ).toBe(false);
  });

  it('open panel allowlist accepts only the four official panels', async () => {
    const tools = createAndroidSettingsTools({ bridge: makeBridge() });
    const tool = tools.find((candidate) => candidate.name === 'android.settings.open_panel');
    if (!tool) throw new Error('tool not found');

    expect(
      tool.inputSchema.safeParse({ connectionId: 'x', panel: 'volume' }).success,
    ).toBe(true);
    expect(
      tool.inputSchema.safeParse({ connectionId: 'x', panel: 'bogus' }).success,
    ).toBe(false);
  });

  it('every production tool is real', async () => {
    const connector = makeConnector(makeBridge());
    const tools = await connector.getTools({} as ConnectionRecord);

    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.implementationStatus).toBe('real');
    }
  });

  it('never exposes low-level or permission-request tools', async () => {
    const connector = makeConnector(makeBridge());
    const tools = await connector.getTools({} as ConnectionRecord);
    const names = tools.map((tool) => tool.name);

    for (const name of names) {
      expect(name).not.toMatch(/^android\.settings\.(set_system|get_system|get_secure|get_global)/u);
      expect(name).not.toMatch(/request_(write_settings|overlay)_permission/u);
      expect(name).not.toMatch(/set_secure|set_global/u);
    }
    expect(names.sort()).toEqual([
      'android.settings.get_auto_rotate',
      'android.settings.get_brightness',
      'android.settings.get_capabilities',
      'android.settings.get_screen_timeout',
      'android.settings.open',
      'android.settings.open_panel',
      'android.settings.set_auto_rotate',
      'android.settings.set_brightness',
      'android.settings.set_screen_timeout',
    ]);
  });
});

describe('mapAndroidSettingsError', () => {
  it('maps known native codes', () => {
    expect(mapAndroidSettingsError({ code: 'ERR_WRITE_SETTINGS_PERMISSION_REQUIRED' }, 'x').code).toBe(
      'PERMISSION_REQUIRED',
    );
    expect(mapAndroidSettingsError({ code: 'ERR_PLATFORM_NOT_SUPPORTED' }, 'x').code).toBe(
      'UNSUPPORTED',
    );
    expect(mapAndroidSettingsError({ code: 'ERR_SETTINGS_SCREEN_UNAVAILABLE' }, 'x').code).toBe(
      'UNSUPPORTED',
    );
    expect(mapAndroidSettingsError({ code: 'ERR_INVALID_ARGUMENT' }, 'x').code).toBe(
      'VALIDATION_FAILED',
    );
    expect(mapAndroidSettingsError({ code: 'ERR_SETTING_READ_FAILED' }, 'x').code).toBe(
      'PROVIDER_ERROR',
    );
  });

  it('falls back to PROVIDER_ERROR for unknown errors', () => {
    expect(mapAndroidSettingsError(new Error('boom'), 'x').code).toBe('PROVIDER_ERROR');
    expect(mapAndroidSettingsError(undefined, 'x').code).toBe('PROVIDER_ERROR');
  });

  it('preserves an existing ConnectorError', () => {
    const original = new ConnectorError('nope', 'PERMISSION_REQUIRED');
    expect(mapAndroidSettingsError(original, 'x')).toBe(original);
  });
});
