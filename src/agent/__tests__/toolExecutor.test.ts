import {
  classifyToolError,
  normalizeToolFailure,
  resolveConnectionIds,
  SCOPE_REMEDIES,
} from '@/agent/toolExecutor';

const SIGNAL_SCOPES = [
  'android.usage.read',
  'android.notifications.read',
  'android.notifications.reply',
  'android.media.read',
  'android.media.control',
];

describe('signal-scope permission classification', () => {
  it('classifies every missing signal scope as PERMISSION_REQUIRED, not auth', () => {
    for (const scope of SIGNAL_SCOPES) {
      expect(
        classifyToolError(
          `Connection "This device" is missing required scopes: ${scope}.`,
        ),
      ).toBe('PERMISSION_REQUIRED');
    }
    // A genuine auth-shaped error still classifies as auth.
    expect(classifyToolError('authorization required')).toBe('AUTH_REQUIRED');
  });

  it('provides a remediation screen for every signal scope', () => {
    for (const scope of SIGNAL_SCOPES) {
      const remedy = SCOPE_REMEDIES.get(scope);
      expect(remedy).toBeTruthy();
      expect(typeof remedy?.screen).toBe('string');
      expect(remedy!.screen.length).toBeGreaterThan(0);
    }
    expect(SCOPE_REMEDIES.get('android.usage.read')?.screen).toBe('usageAccess');
    expect(
      SCOPE_REMEDIES.get('android.notifications.read')?.screen,
    ).toBe('notificationListener');
    expect(SCOPE_REMEDIES.get('android.media.control')?.screen).toBe(
      'notificationListener',
    );
  });
});

describe('Android execution prerequisites', () => {
  const android = {
    id: 'android-device',
    provider: 'android',
    displayName: 'This device',
    capabilities: [],
  };

  it('injects the sole active Android connection when the model omits it', () => {
    const [resolved] = resolveConnectionIds(
      [
        {
          id: 'usage',
          toolName: 'android.usage.recent',
          args: { days: 7 },
        },
      ],
      [android],
    );

    expect(resolved?.args).toEqual({ days: 7, connectionId: 'android-device' });
  });

  it('does not invent an Android connection when none is connected', () => {
    const [resolved] = resolveConnectionIds(
      [
        {
          id: 'usage',
          toolName: 'android.usage.recent',
          args: { days: 7 },
        },
      ],
      [],
    );

    expect(resolved?.args).toEqual({ days: 7 });
  });

  it('turns assistant NOT_ALLOWED JSON into readable permission guidance', () => {
    const failure = normalizeToolFailure(
      'android.assistant.get_screen_context',
      'Backend error: {"code":"NOT_ALLOWED","detail":"role missing"}',
    );

    expect(failure.errorCode).toBe('PERMISSION_REQUIRED');
    expect(failure.message).toContain('not the active Android assistant');
    expect(failure.message).not.toContain('{');
    expect(failure.message).not.toContain('NOT_ALLOWED');
  });

  it('extracts readable assistant errors instead of showing raw JSON', () => {
    const failure = normalizeToolFailure(
      'android.assistant.get_status',
      '{"detail":{"message":"Assistant service is unavailable."}}',
    );

    expect(failure.message).toBe('Assistant service is unavailable.');
    expect(failure.message).not.toContain('{');
  });
});
