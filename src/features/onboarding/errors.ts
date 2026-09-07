/**
 * Machine-readable failure codes → user-facing copy.
 *
 * Raw backend errors are never shown verbatim. A code the backend (or the
 * agent runtime) returns is mapped onto a line a user can act on; anything
 * unrecognized collapses to a generic message rather than leaking internals.
 */
export interface OnboardingErrorCopy {
  title?: string;
  message: string;
}

const CODE_COPY: Record<string, OnboardingErrorCopy> = {
  LOCAL_MODEL_NOT_SUPPORTED: {
    message:
      "Local AI isn't available on this device.\nYou can use Creepy with Cloud AI instead.",
  },
  LOCAL_MODEL_NOT_DOWNLOADED: {
    message: 'Download the local model to use Creepy on this phone.',
  },
  GOOGLE_NOT_CONNECTED: {
    message: 'Connect Google to use this action.',
  },
  GMAIL_SCOPE_REQUIRED: {
    message: 'Creepy needs Gmail access for this request.',
  },
  TELEGRAM_NOT_CONNECTED: {
    message: 'Connect Telegram to use this action.',
  },
  CONNECTION_NOT_FOUND: {
    message: 'That connection is no longer available. Connect it again to keep using this action.',
  },
  CONNECTION_EXPIRED: {
    message: 'That connection has expired. Reconnect to continue.',
  },
  PERMISSION_REQUIRED: {
    title: 'Permission needed',
    message: 'Creepy needs extra access to do this.',
  },
  AUTH_REQUIRED: {
    message: 'Your session expired. Sign in again to continue.',
  },
  RATE_LIMITED: {
    message:
      "You have used up today's Creepy actions. Come back later or continue with a plan.",
  },
  NETWORK_ERROR: {
    message: 'Could not reach Creepy. Check your connection and try again.',
  },
  MODEL_ERROR: {
    message: 'Creepy could not finish this request. Please try again.',
  },
  MAX_STEPS_EXCEEDED: {
    message:
      'This request needed too many steps and Creepy stopped. Try something simpler.',
  },
};

/**
 * Pull the machine code off an error without depending on a specific error
 * class. Both `ApiError` and `AgentError` carry a `code` string; the duck-typed
 * check keeps this module usable from unit tests with no import graph.
 */
export function onboardingErrorCode(error: unknown): string | null {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return null;
}

export function describeOnboardingError(error: unknown): OnboardingErrorCopy {
  const code = onboardingErrorCode(error);
  if (code && CODE_COPY[code]) return CODE_COPY[code];

  // A mapped code is the only case where the message is trusted to be
  // user-facing; everything else is generic so internals never leak.
  return { message: 'Something went wrong. Please try again.' };
}

/**
 * A failure that a connection would fix, mapped to the connect screen to open.
 * Lets the chat's failure card offer "Connect Telegram" / "Continue with
 * Google" instead of a dead-end error.
 */
export type ConnectionAction = 'google' | 'telegram';

export function connectionActionForCode(
  code: string | null,
): ConnectionAction | null {
  if (code === 'GOOGLE_NOT_CONNECTED' || code === 'GMAIL_SCOPE_REQUIRED') {
    return 'google';
  }
  if (code === 'TELEGRAM_NOT_CONNECTED') return 'telegram';
  return null;
}

export function connectionActionLabel(action: ConnectionAction): string {
  return action === 'google' ? 'Continue with Google' : 'Connect Telegram';
}

export function routeForConnectionAction(action: ConnectionAction): string {
  return action === 'google' ? '/connect/google' : '/connect/telegram';
}