import type { TdlibAuthState, TdUser } from './types';

/**
 * Maps raw TDLib authorization-state objects to the internal
 * `TdlibAuthState` discriminated union.
 *
 * Unknown / intermediate states fall back to `initializing` so the
 * adapter never crashes on TDLib states it does not yet handle.
 */
export function mapAuthorizationState(
  raw: Record<string, unknown> | null,
): TdlibAuthState {
  if (!raw || typeof raw !== 'object') {
    return { type: 'initializing' };
  }

  const type = raw['@type'] ?? (raw as Record<string, unknown>)['_'] ?? '';
  const typeStr = String(type).replace(/^authorizationState/, '');

  switch (typeStr) {
    case 'WaitPhoneNumber':
      return { type: 'wait_phone_number' };

    case 'WaitCode': {
      const info = raw.code_info as Record<string, unknown> | undefined;
      const codeLength =
        typeof info?.length === 'number'
          ? (info.length as number)
          : undefined;
      return { type: 'wait_code', codeLength };
    }

    case 'WaitPassword': {
      const passwordHint =
        typeof raw.password_hint === 'string'
          ? (raw.password_hint as string)
          : undefined;
      return { type: 'wait_password', passwordHint };
    }

    case 'Ready':
      return { type: 'ready', user: { id: '' } };

    case 'LoggingOut':
      return { type: 'logging_out' };

    case 'Closed':
      return { type: 'closed' };

    default:
      return { type: 'initializing' };
  }
}

/**
 * Extracts a user profile from a raw TDLib user object and merges it into
 * the current auth state when transitioning to `ready`.
 */
export function mapTdUser(raw: Record<string, unknown>): TdUser {
  return {
    id: String(raw.id ?? ''),
    firstName:
      typeof raw.first_name === 'string'
        ? (raw.first_name as string)
        : undefined,
    lastName:
      typeof raw.last_name === 'string'
        ? (raw.last_name as string)
        : undefined,
    username:
      typeof raw.usernames === 'object' && raw.usernames != null
        ? String(
            (raw.usernames as Record<string, unknown>).active_usernames ??
              '',
          ) || undefined
        : typeof raw.username === 'string'
          ? (raw.username as string)
          : undefined,
  };
}

/**
 * Parses an E.164 phone number into country code and local number parts
 * expected by `react-native-tdlib`'s `login()`.
 */
export function parsePhoneNumber(phoneNumber: string): {
  countrycode: string;
  phoneNumber: string;
} {
  const cleaned = phoneNumber.replace(/[\s()\-–]/gu, '');

  if (cleaned.startsWith('+')) {
    // E.164: +7 (701) 123-45-67 → countrycode: '+7', phoneNumber: '7011234567'
    const match = /^(\+\d{1,3})(\d+)$/u.exec(cleaned);
    if (match) {
      return { countrycode: match[1], phoneNumber: match[2] };
    }
  }

  // Fallback: strip leading '+' and use everything as phone number
  const digits = cleaned.replace(/^\+/u, '');
  return { countrycode: '', phoneNumber: digits };
}
