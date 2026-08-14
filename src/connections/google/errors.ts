/**
 * Human-readable text for the native module's rejection codes.
 *
 * `GoogleAuthorizationModule` rejects with a stable code and a diagnostic
 * message aimed at logcat — statusCode, resultCode, the raw ApiException. That
 * is the right thing for a bug report and the wrong thing for a screen, so the
 * code selects the copy and the original message is kept for the details line
 * rather than shown as the headline.
 *
 * Cancellation is deliberately not an error: the user closing Google's sheet
 * is them choosing not to connect, so the caller returns to the idle state
 * with nothing red on screen.
 */

export type GoogleAuthFailure =
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string; detail?: string };

const MESSAGES: Record<string, string> = {
  INVALID_SCOPES: 'No Google permissions were requested. This is a bug in the app.',
  NO_ACTIVITY:
    'The app was in the background when Google tried to ask for consent. Try again with the app open.',
  NO_RESOLUTION:
    'Google needed to ask for consent but did not provide a screen to do it. Try again.',
  AUTHORIZE_FAILED: 'Google could not complete sign-in.',
  RECONNECT_REQUIRED:
    'Google needs you to sign in again before it will grant access.',
  TOKEN_FAILED: 'Google refused to issue an access token.',
  CLEAR_TOKEN_FAILED: 'The stored Google token could not be cleared.',
  REVOKE_FAILED: 'Google access could not be revoked.',
  INVALID_REVOKE_REQUEST:
    'Revoking access needs an account or a scope. This is a bug in the app.',
};

/**
 * The module is absent whenever the native half was not built into the APK.
 * That is a build problem rather than anything the user did, so it is named as
 * one instead of being reported as a Google failure.
 */
const NO_BRIDGE =
  'This build has no native Google bridge, so sign-in cannot run. Rebuild the app with the native module included.';

export function describeGoogleAuthError(error: unknown): GoogleAuthFailure {
  const code = (error as { code?: unknown } | null)?.code;
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');

  if (code === 'AUTHORIZE_CANCELLED') return { kind: 'cancelled' };

  // expo-router and the connector layer both re-wrap rejections, and a
  // re-wrapped error keeps the message but loses `code`. Match the text too so
  // a cancel does not surface as a failure just because it crossed a boundary.
  if (/cancel/iu.test(rawMessage) && !/cancellation/iu.test(rawMessage)) {
    return { kind: 'cancelled' };
  }

  if (/no native authorization bridge|unavailable in this runtime/iu.test(rawMessage)) {
    return { kind: 'error', message: NO_BRIDGE };
  }

  if (typeof code === 'string' && MESSAGES[code]) {
    return {
      kind: 'error',
      message: MESSAGES[code],
      ...(rawMessage && rawMessage !== MESSAGES[code]
        ? { detail: rawMessage }
        : {}),
    };
  }

  return {
    kind: 'error',
    message: rawMessage || 'Google sign-in failed for an unknown reason.',
  };
}
