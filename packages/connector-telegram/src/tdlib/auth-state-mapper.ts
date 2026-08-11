import type { TdlibAuthState, TdUser } from './types';

/**
 * Maps raw TDLib authorization-state objects to the internal
 * `TdlibAuthState` discriminated union.
 *
 * The `Ready` case NEVER produces an application-level ready state
 * on its own — the caller must first load the profile via
 * `getProfile()` and transition to `ready` with a valid user.
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
      // TDLib says "Ready", but we need the user profile before
      // we can create an application-level `ready` state.
      // Caller must call `resolveReadyUser()` separately.
      return { type: 'initializing' };

    case 'LoggingOut':
      return { type: 'logging_out' };

    case 'Closed':
      return { type: 'closed' };

    default:
      return { type: 'initializing' };
  }
}

/**
 * Extracts a user profile from a raw TDLib user object.
 */
export function mapTdUser(raw: Record<string, unknown>): TdUser {
  const usernamesRaw = raw.usernames as Record<string, unknown> | undefined;
  const active = Array.isArray(usernamesRaw?.active_usernames)
    ? (usernamesRaw.active_usernames as string[])
    : [];

  const username =
    typeof active[0] === 'string'
      ? active[0]
      : typeof raw.username === 'string'
        ? (raw.username as string)
        : undefined;

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
    username,
  };
}

/**
 * Validates an E.164 phone number.
 * Throws if the number is obviously malformed.
 */
export function validatePhoneNumber(raw: string): string {
  const cleaned = raw.replace(/[\s()\-–]/gu, '');

  if (!cleaned.startsWith('+')) {
    throw new Error('Phone number must start with + and include a country code.');
  }

  const digitsOnly = cleaned.slice(1);
  if (!/^\d+$/u.test(digitsOnly)) {
    throw new Error('Phone number must contain only digits after +.');
  }

  if (digitsOnly.length < 7 || digitsOnly.length > 15) {
    throw new Error('Phone number must be between 7 and 15 digits.');
  }

  return cleaned;
}

/**
 * Extracts country code and local number from a validated E.164 number.
 *
 * `react-native-tdlib`'s `login()` concatenates `countrycode + phoneNumber`,
 * so we pass the full cleaned number as `phoneNumber` with an empty
 * countrycode to avoid any splitting ambiguity.
 */
export function parsePhoneNumber(_phoneNumber: string): {
  countrycode: string;
  phoneNumber: string;
} {
  // `react-native-tdlib` simply concatenates the two fields.
  // Passing the full E.164 string as phoneNumber avoids incorrect
  // splitting of country codes.
  const normalized = _phoneNumber.replace(/[\s()\-–]/gu, '');
  return { countrycode: '', phoneNumber: normalized };
}
