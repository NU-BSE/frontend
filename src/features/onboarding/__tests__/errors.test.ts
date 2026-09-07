import {
  connectionActionForCode,
  connectionActionLabel,
  describeOnboardingError,
  onboardingErrorCode,
  routeForConnectionAction,
} from '@/features/onboarding/errors';

class CodedError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

describe('onboarding error mapping', () => {
  it('21. maps machine codes to friendly copy', () => {
    expect(
      describeOnboardingError(new CodedError('LOCAL_MODEL_NOT_SUPPORTED', 'x'))
        .message,
    ).toContain("Local AI isn't available on this device.");
    expect(
      describeOnboardingError(new CodedError('LOCAL_MODEL_NOT_DOWNLOADED', 'x'))
        .message,
    ).toBe('Download the local model to use Creepy on this phone.');
    expect(
      describeOnboardingError(new CodedError('GOOGLE_NOT_CONNECTED', 'x')).message,
    ).toBe('Connect Google to use this action.');
    expect(
      describeOnboardingError(new CodedError('GMAIL_SCOPE_REQUIRED', 'x')).message,
    ).toBe('Creepy needs Gmail access for this request.');
    expect(
      describeOnboardingError(new CodedError('TELEGRAM_NOT_CONNECTED', 'x'))
        .message,
    ).toBe('Connect Telegram to use this action.');
  });

  it('never leaks raw backend messages', () => {
    expect(describeOnboardingError(new Error('Internal server error')).message).toBe(
      'Something went wrong. Please try again.',
    );
    // An unknown code is also treated as generic.
    const unknown = new CodedError('WHATEVER', 'some raw backend detail');
    expect(describeOnboardingError(unknown).message).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('extracts a code from any Error that carries one', () => {
    expect(onboardingErrorCode(new CodedError('RATE_LIMITED', 'x'))).toBe(
      'RATE_LIMITED',
    );
    expect(onboardingErrorCode(new Error('plain'))).toBeNull();
  });

  it('17. maps connection failures to a contextual connect action', () => {
    expect(connectionActionForCode('GOOGLE_NOT_CONNECTED')).toBe('google');
    expect(connectionActionForCode('GMAIL_SCOPE_REQUIRED')).toBe('google');
    expect(connectionActionForCode('TELEGRAM_NOT_CONNECTED')).toBe('telegram');
    expect(connectionActionForCode('NETWORK_ERROR')).toBeNull();
    expect(connectionActionLabel('google')).toBe('Continue with Google');
    expect(connectionActionLabel('telegram')).toBe('Connect Telegram');
    expect(routeForConnectionAction('google')).toBe('/connect/google');
    expect(routeForConnectionAction('telegram')).toBe('/connect/telegram');
  });
});
