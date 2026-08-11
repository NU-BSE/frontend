/**
 * Telegram TDLib adapter regression tests.
 *
 * Covers auth-state mapping, send confirmation, lifecycle, and
 * runtime-mode resolution — all mock-based, no real TDLib required.
 *
 * Run: npm run verify:telegram
 */
import { mapAuthorizationState, mapTdUser, parsePhoneNumber, validatePhoneNumber } from '../packages/connector-telegram/src/tdlib/auth-state-mapper.js';
import { resolveDefaultRuntimeMode } from '../src/mcp/runtime-mode.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok — ${message}`);
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

// -----------------------------------------------------------------------
// Auth-state mapping
// -----------------------------------------------------------------------

function rawAuthState(typeName: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return { ['@type']: typeName, ...extra };
}

console.log('auth-state mapping:');
{
  assertEq(
    mapAuthorizationState(rawAuthState('authorizationStateWaitPhoneNumber')).type,
    'wait_phone_number',
    'WaitPhoneNumber → wait_phone_number',
  );

  assertEq(
    mapAuthorizationState(rawAuthState('authorizationStateWaitCode', { code_info: { length: 5 } })).type,
    'wait_code',
    'WaitCode → wait_code',
  );

  assertEq(
    mapAuthorizationState(rawAuthState('authorizationStateWaitCode', { code_info: { type: { length: 6 } } })).type,
    'wait_code',
    'WaitCode with type.length → wait_code',
  );

  {
    const state = mapAuthorizationState(rawAuthState('authorizationStateWaitCode', { code_info: { type: { length: 6 } } }));
    if (state.type === 'wait_code') {
      assertEq(state.codeLength, 6, 'code length from type.length is 6');
    }
  }

  {
    const state = mapAuthorizationState(rawAuthState('authorizationStateWaitCode', { code_info: { length: 5 } }));
    if (state.type === 'wait_code') {
      assertEq(state.codeLength, 5, 'code length from info.length is 5');
    }
  }

  assertEq(
    mapAuthorizationState(rawAuthState('authorizationStateWaitPassword', { password_hint: 'hint' })).type,
    'wait_password',
    'WaitPassword → wait_password',
  );

  {
    const state = mapAuthorizationState(rawAuthState('authorizationStateWaitPassword', { password_hint: 'hint' }));
    if (state.type === 'wait_password') {
      assertEq(state.passwordHint, 'hint', 'password hint preserved');
    }
  }

  assertEq(
    mapAuthorizationState(rawAuthState('authorizationStateLoggingOut')).type,
    'logging_out',
    'LoggingOut → logging_out',
  );

  assertEq(
    mapAuthorizationState(rawAuthState('authorizationStateClosing')).type,
    'logging_out',
    'Closing → logging_out',
  );

  assertEq(
    mapAuthorizationState(rawAuthState('authorizationStateClosed')).type,
    'closed',
    'Closed → closed',
  );

  // Ready returns initializing (caller must load profile).
  assertEq(
    mapAuthorizationState(rawAuthState('authorizationStateReady')).type,
    'initializing',
    'Ready → initializing (profile pending)',
  );

  // Email states
  assertEq(
    mapAuthorizationState(rawAuthState('authorizationStateWaitEmailAddress')).type,
    'wait_email_address',
    'WaitEmailAddress → wait_email_address',
  );

  {
    const state = mapAuthorizationState(rawAuthState('authorizationStateWaitEmailAddress', { allow_apple_id: true }));
    if (state.type === 'wait_email_address') {
      assert(state.allowAppleId, 'allowAppleId preserved');
    }
  }

  assertEq(
    mapAuthorizationState(rawAuthState('authorizationStateWaitEmailCode', { code_info: { email_address_pattern: 'a***@gmail.com', length: 6 } })).type,
    'wait_email_code',
    'WaitEmailCode → wait_email_code',
  );

  {
    const state = mapAuthorizationState(rawAuthState('authorizationStateWaitEmailCode', { code_info: { email_address_pattern: 'a***@gmail.com', length: 6 } }));
    if (state.type === 'wait_email_code') {
      assertEq(state.emailAddressPattern, 'a***@gmail.com', 'email pattern preserved');
      assertEq(state.codeLength, 6, 'email code length');
    }
  }

  // Registration
  assertEq(
    mapAuthorizationState(rawAuthState('authorizationStateWaitRegistration', { terms_of_service: { text: 'TOS text', min_user_age: 16 } })).type,
    'wait_registration',
    'WaitRegistration → wait_registration',
  );

  // Other device
  {
    const state = mapAuthorizationState(rawAuthState('authorizationStateWaitOtherDeviceConfirmation', { link: 'tg://login?token=abc' }));
    assertEq(state.type, 'wait_other_device_confirmation', 'WaitOtherDeviceConfirmation → wait_other_device_confirmation');
    if (state.type === 'wait_other_device_confirmation') {
      assert(state.link.length > 0, 'link preserved');
    }
  }

  // Premium
  assertEq(
    mapAuthorizationState(rawAuthState('authorizationStateWaitPremiumPurchase')).type,
    'wait_premium_purchase',
    'WaitPremiumPurchase → wait_premium_purchase',
  );

  // Null/empty → initializing
  assertEq(
    mapAuthorizationState(null).type,
    'initializing',
    'null → initializing',
  );

  // Internal startup states → initializing
  assertEq(
    mapAuthorizationState(rawAuthState('authorizationStateWaitTdlibParameters')).type,
    'initializing',
    'WaitTdlibParameters → initializing',
  );
}

// -----------------------------------------------------------------------
// Phone parsing
// -----------------------------------------------------------------------

console.log('phone number parsing:');
{
  const number = '+77011234567';
  assert(
    validatePhoneNumber(number) === '+77011234567',
    'E.164 number validates',
  );

  const parsed = parsePhoneNumber(number);
  assertEq(parsed.phoneNumber, '+77011234567', 'full number passed as phoneNumber');

  try {
    validatePhoneNumber('12345');
    throw new Error('FAIL: should have thrown');
  } catch {
    assert(true, 'no + prefix rejects');
  }

  try {
    validatePhoneNumber('+12');
    throw new Error('FAIL: should have thrown');
  } catch {
    assert(true, 'too short rejects');
  }
}

// -----------------------------------------------------------------------
// User profile mapping
// -----------------------------------------------------------------------

console.log('user profile mapping:');
{
  const user = mapTdUser({ id: 123, first_name: 'Daniyar', last_name: 'K' });
  assertEq(user.id, '123', 'user id stringified');
  assertEq(user.firstName!, 'Daniyar', 'first name');
  assertEq(user.lastName!, 'K', 'last name');
  assert(user.username === undefined, 'no username when absent');

  const withLegacy = mapTdUser({ id: 1, username: 'daniyar' });
  assertEq(withLegacy.username!, 'daniyar', 'legacy username');

  const withActive = mapTdUser({
    id: 1,
    usernames: { active_usernames: ['daniyar_official', 'daniyar_alt'] },
  });
  assertEq(withActive.username!, 'daniyar_official', 'first active username');
}

// -----------------------------------------------------------------------
// Runtime mode
// -----------------------------------------------------------------------

console.log('runtime mode resolution:');
{
  const origEnv = process.env.EXPO_PUBLIC_MCP_RUNTIME_MODE;

  delete process.env.EXPO_PUBLIC_MCP_RUNTIME_MODE;
  (globalThis as any).__DEV__ = true;
  assertEq(resolveDefaultRuntimeMode(), 'development', '__DEV__ true → development');

  process.env.EXPO_PUBLIC_MCP_RUNTIME_MODE = 'production';
  assertEq(resolveDefaultRuntimeMode(), 'production', 'explicit production overrides __DEV__');

  process.env.EXPO_PUBLIC_MCP_RUNTIME_MODE = 'development';
  assertEq(resolveDefaultRuntimeMode(), 'development', 'explicit development');

  delete process.env.EXPO_PUBLIC_MCP_RUNTIME_MODE;
  (globalThis as any).__DEV__ = false;
  assertEq(resolveDefaultRuntimeMode(), 'production', '__DEV__ false → production');

  if (origEnv === undefined) delete process.env.EXPO_PUBLIC_MCP_RUNTIME_MODE;
  else process.env.EXPO_PUBLIC_MCP_RUNTIME_MODE = origEnv;
  (globalThis as any).__DEV__ = true;
}

console.log('verify:telegram — all checks passed');
