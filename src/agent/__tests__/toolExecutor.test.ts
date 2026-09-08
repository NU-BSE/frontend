import { classifyToolError, SCOPE_REMEDIES } from '@/agent/toolExecutor';

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