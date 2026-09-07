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
  type AndroidAssistantBridge,
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
      supportedScreens: {
        wifi: true,
        bluetooth: true,
        batteryUsage: true,
        settingsSearch: true,
      },
      supportedAppTargets: {
        appDetails: true,
        appNotifications: true,
        exactAlarm: true,
        fullScreenIntent: true,
      },
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

function makeAssistantBridge(
  overrides: Partial<AndroidAssistantBridge> = {},
): AndroidAssistantBridge {
  return {
    getStatus: async () => ({
      roleAvailable: true,
      isDefault: false,
      serviceReady: false,
    }),
    requestRole: async () => true,
    openSettings: async () => true,
    getScreenContext: async () => null,
    ...overrides,
  };
}

function makeConnector(
  bridge: AndroidSettingsBridge,
  store = new InMemoryConnectionStore(),
  assistantBridge?: AndroidAssistantBridge,
): AndroidConnector {
  return new AndroidConnector({
    store,
    settingsBridge: bridge,
    ...(assistantBridge ? { assistantBridge } : {}),
  });
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
    expect(record.capabilities).toContain('android.apps.read');
    expect(record.capabilities).toContain('android.settings.app_navigation');
  });

  it('grants assistant scopes only when the assistant bridge is present', async () => {
    const settingsOnly = await makeConnector(makeBridge()).connect();
    expect(settingsOnly.scopes).not.toContain('android.assistant.read');
    expect(settingsOnly.capabilities).not.toContain('android.assistant.manage');

    const withAssistant = await makeConnector(
      makeBridge(),
      new InMemoryConnectionStore(),
      makeAssistantBridge(),
    ).connect();

    expect(withAssistant.scopes).toEqual(
      expect.arrayContaining([
        'android.assistant.read',
        'android.assistant.manage',
        'android.assistant.screen_context',
      ]),
    );
    expect(withAssistant.capabilities).toEqual(
      expect.arrayContaining([
        'android.assistant.read',
        'android.assistant.manage',
        'android.assistant.screen_context',
      ]),
    );
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
    const record = await makeConnector(
      makeBridge({
        canWriteSystemSettings: () => false,
        canDrawOverlays: () => true,
      }),
    ).connect();
    expect(record.scopes).toEqual(['android.settings.read', 'android.overlay']);
  });

  it('reports implementationStatus partial', () => {
    expect(makeConnector(makeBridge()).implementationStatus).toBe('partial');
  });
});

describe('AndroidConnector tools', () => {
  it('reads and writes core typed settings', async () => {
    const setBrightness = jest.fn(() => true);
    const setBrightnessMode = jest.fn(() => true);
    const setHaptics = jest.fn(() => true);
    const bridge = makeBridge({
      setScreenBrightnessPercent: setBrightness,
      setBrightnessMode,
      setHapticFeedbackEnabled: setHaptics,
    });
    const tools = createAndroidSettingsTools({ bridge });

    expect(
      await executeTool(tools, 'android.settings.get_brightness', {
        connectionId: ANDROID_CONNECTION_ID,
      }),
    ).toEqual({ percent: 50, raw: 128 });

    expect(
      await executeTool(tools, 'android.settings.set_brightness', {
        connectionId: ANDROID_CONNECTION_ID,
        percent: 40,
      }),
    ).toEqual({ percent: 40 });
    expect(setBrightness).toHaveBeenCalledWith(40);

    expect(
      await executeTool(tools, 'android.settings.set_brightness_mode', {
        connectionId: ANDROID_CONNECTION_ID,
        mode: 'manual',
      }),
    ).toEqual({ mode: 'manual' });
    expect(setBrightnessMode).toHaveBeenCalledWith('manual');

    expect(
      await executeTool(tools, 'android.settings.set_haptic_feedback', {
        connectionId: ANDROID_CONNECTION_ID,
        enabled: false,
      }),
    ).toEqual({ enabled: false });
    expect(setHaptics).toHaveBeenCalledWith(false);
  });

  it('finds apps and reads app info', async () => {
    const tools = createAndroidSettingsTools({ bridge: makeBridge() });
    const found = (await executeTool(tools, 'android.apps.find', {
      connectionId: ANDROID_CONNECTION_ID,
      query: 'telegram',
    })) as { apps: Array<{ packageName: string }> };
    expect(found.apps[0]?.packageName).toBe('org.telegram.messenger');

    const info = (await executeTool(tools, 'android.apps.get_info', {
      connectionId: ANDROID_CONNECTION_ID,
      packageName: 'org.telegram.messenger',
    })) as { app: { label: string } | null };
    expect(info.app?.label).toBe('Telegram');
  });

  it('opens package-scoped settings with package and channel arguments', async () => {
    const openAppSettings = jest.fn(async () => true);
    const tools = createAndroidSettingsTools({
      bridge: makeBridge({ openAppSettings }),
    });

    expect(
      await executeTool(tools, 'android.settings.open_app', {
        connectionId: ANDROID_CONNECTION_ID,
        target: 'notificationChannel',
        packageName: 'org.telegram.messenger',
        channelId: 'messages',
      }),
    ).toEqual({
      opened: true,
      target: 'notificationChannel',
      packageName: 'org.telegram.messenger',
      channelId: 'messages',
    });
    expect(openAppSettings).toHaveBeenCalledWith(
      'notificationChannel',
      'org.telegram.messenger',
      'messages',
    );
  });

  it('accepts exact-alarm and full-screen-intent app destinations', () => {
    const tools = createAndroidSettingsTools({ bridge: makeBridge() });
    const tool = tools.find((candidate) => candidate.name === 'android.settings.open_app');
    if (!tool) throw new Error('tool not found');

    for (const target of ['exactAlarm', 'fullScreenIntent']) {
      expect(
        tool.inputSchema.safeParse({
          connectionId: 'x',
          target,
          packageName: 'com.example.alarm',
        }).success,
      ).toBe(true);
    }
  });

  it('requires channelId only for notificationChannel', () => {
    const tools = createAndroidSettingsTools({ bridge: makeBridge() });
    const tool = tools.find((candidate) => candidate.name === 'android.settings.open_app');
    if (!tool) throw new Error('tool not found');

    expect(
      tool.inputSchema.safeParse({
        connectionId: 'x',
        target: 'notificationChannel',
        packageName: 'org.telegram.messenger',
      }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({
        connectionId: 'x',
        target: 'appDetails',
        packageName: 'org.telegram.messenger',
      }).success,
    ).toBe(true);
  });

  it('rejects missing WRITE_SETTINGS with PERMISSION_REQUIRED', async () => {
    const tools = createAndroidSettingsTools({
      bridge: makeBridge({ canWriteSystemSettings: () => false }),
    });
    await expect(
      executeTool(tools, 'android.settings.set_sound_effects', {
        connectionId: ANDROID_CONNECTION_ID,
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
  });

  it('validates brightness and timeout ranges', () => {
    const tools = createAndroidSettingsTools({ bridge: makeBridge() });
    const brightness = tools.find((candidate) => candidate.name === 'android.settings.set_brightness');
    const timeout = tools.find((candidate) => candidate.name === 'android.settings.set_screen_timeout');
    if (!brightness || !timeout) throw new Error('tool not found');

    expect(brightness.inputSchema.safeParse({ connectionId: 'x', percent: 101 }).success).toBe(false);
    expect(brightness.inputSchema.safeParse({ connectionId: 'x', percent: 100 }).success).toBe(true);
    expect(timeout.inputSchema.safeParse({ connectionId: 'x', milliseconds: -1 }).success).toBe(false);
    expect(timeout.inputSchema.safeParse({ connectionId: 'x', milliseconds: 30000 }).success).toBe(true);
  });

  it('exposes guide destinations but keeps connector grant screens out', () => {
    const tools = createAndroidSettingsTools({ bridge: makeBridge() });
    const tool = tools.find((candidate) => candidate.name === 'android.settings.open');
    if (!tool) throw new Error('tool not found');

    for (const screen of [
      'assistant',
      'batteryOptimization',
      'batteryUsage',
      'wifiIp',
      'doNotDisturbPriority',
      'settingsSearch',
    ]) {
      expect(tool.inputSchema.safeParse({ connectionId: 'x', screen }).success).toBe(true);
    }

    for (const screen of ['writeSettings', 'overlay', 'unknownSources']) {
      expect(tool.inputSchema.safeParse({ connectionId: 'x', screen }).success).toBe(false);
    }
  });

  it('open panel accepts only the official panels', () => {
    const tools = createAndroidSettingsTools({ bridge: makeBridge() });
    const tool = tools.find((candidate) => candidate.name === 'android.settings.open_panel');
    if (!tool) throw new Error('tool not found');
    expect(tool.inputSchema.safeParse({ connectionId: 'x', panel: 'volume' }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ connectionId: 'x', panel: 'bogus' }).success).toBe(false);
  });

  it('every production tool is real and no raw Settings keys are exposed', async () => {
    const tools = await makeConnector(makeBridge()).getTools({} as ConnectionRecord);
    for (const tool of tools) {
      expect(tool.implementationStatus).toBe('real');
      expect(tool.name).not.toMatch(/^android\.settings\.(set_system|get_system|get_secure|get_global)/u);
      expect(tool.name).not.toMatch(/request_(write_settings|overlay)_permission/u);
      expect(tool.name).not.toMatch(/set_secure|set_global/u);
    }

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'android.apps.find',
      'android.apps.get_info',
      'android.settings.get_auto_rotate',
      'android.settings.get_brightness',
      'android.settings.get_brightness_mode',
      'android.settings.get_capabilities',
      'android.settings.get_haptic_feedback',
      'android.settings.get_screen_timeout',
      'android.settings.get_sound_effects',
      'android.settings.open',
      'android.settings.open_app',
      'android.settings.open_panel',
      'android.settings.set_auto_rotate',
      'android.settings.set_brightness',
      'android.settings.set_brightness_mode',
      'android.settings.set_haptic_feedback',
      'android.settings.set_screen_timeout',
      'android.settings.set_sound_effects',
    ]);
  });
});

describe('mapAndroidSettingsError', () => {
  it('maps known native codes', () => {
    expect(mapAndroidSettingsError({ code: 'ERR_WRITE_SETTINGS_PERMISSION_REQUIRED' }, 'x').code).toBe('PERMISSION_REQUIRED');
    expect(mapAndroidSettingsError({ code: 'ERR_PLATFORM_NOT_SUPPORTED' }, 'x').code).toBe('UNSUPPORTED');
    expect(mapAndroidSettingsError({ code: 'ERR_SETTINGS_SCREEN_UNAVAILABLE' }, 'x').code).toBe('UNSUPPORTED');
    expect(mapAndroidSettingsError({ code: 'ERR_INVALID_ARGUMENT' }, 'x').code).toBe('VALIDATION_FAILED');
    expect(mapAndroidSettingsError({ code: 'ERR_SETTING_READ_FAILED' }, 'x').code).toBe('PROVIDER_ERROR');
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
