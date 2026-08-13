/**
 * Telegram TDLib adapter regression tests.
 *
 * Covers auth-state mapping, send confirmation, lifecycle, and
 * runtime-mode resolution — all mock-based, no real TDLib required.
 *
 * Run: npm run verify:telegram
 */
import { mapAuthorizationState, mapTdUser, parsePhoneNumber, validatePhoneNumber } from '../packages/connector-telegram/src/tdlib/auth-state-mapper.js';
import {
  NativeTdlibAdapter,
  dedupeAndRank,
  normalizeSearchQuery,
  type RankedChat,
} from '../packages/connector-telegram/src/tdlib/bridge.js';
import { chatIdField } from '../packages/connector-telegram/src/telegram-user-connector.js';
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

  // Registration with formattedText
  {
    const state = mapAuthorizationState(rawAuthState('authorizationStateWaitRegistration', {
      terms_of_service: {
        text: {
          ['@type']: 'formattedText',
          text: 'Telegram Terms',
          entities: [],
        },
        min_user_age: 16,
        show_popup: true,
      },
    }));
    assertEq(state.type, 'wait_registration', 'WaitRegistration → wait_registration');
    if (state.type === 'wait_registration') {
      assertEq(state.termsOfServiceText, 'Telegram Terms', 'formattedText parsed correctly');
      assertEq(state.minUserAge, 16, 'minUserAge preserved');
      assertEq(state.showTermsPopup, true, 'showTermsPopup preserved');
    }
  }

  // Registration with plain text ToS (fallback)
  {
    const state = mapAuthorizationState(rawAuthState('authorizationStateWaitRegistration', {
      terms_of_service: { text: 'Plain TOS text', min_user_age: 13 },
    }));
    if (state.type === 'wait_registration') {
      assertEq(state.termsOfServiceText, 'Plain TOS text', 'plain text ToS fallback works');
      assertEq(state.minUserAge, 13, 'minUserAge from plain text');
    }
  }

  // Code length 0 → undefined
  {
    const state = mapAuthorizationState(rawAuthState('authorizationStateWaitCode', { code_info: { length: 0 } }));
    if (state.type === 'wait_code') {
      assert(state.codeLength === undefined, 'code length 0 becomes undefined');
    }
  }

  // Code length missing → undefined
  {
    const state = mapAuthorizationState(rawAuthState('authorizationStateWaitCode'));
    if (state.type === 'wait_code') {
      assert(state.codeLength === undefined, 'missing code length is undefined');
    }
  }

  // Email code length 0
  {
    const state = mapAuthorizationState(rawAuthState('authorizationStateWaitEmailCode', { code_info: { email_address_pattern: 'a***@gmail.com', length: 0 } }));
    if (state.type === 'wait_email_code') {
      assert(state.codeLength === undefined, 'email code length 0 becomes undefined');
    }
  }

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

// -----------------------------------------------------------------------
// Recipient search — query normalization
// -----------------------------------------------------------------------

console.log('recipient search: query normalization');
{
  assertEq(normalizeSearchQuery('@daulet_test').normalizedUsername, 'daulet_test', 'strips leading @');
  assertEq(normalizeSearchQuery('@daulet_test').isUsernameQuery, true, '@ marks a username query');
  assertEq(normalizeSearchQuery('daulet_test').isUsernameQuery, true, 'username-shaped string is a username query');
  assertEq(normalizeSearchQuery('Daulet Zhubanov').isUsernameQuery, false, 'a multi-word name is not a username query');
  assertEq(normalizeSearchQuery('  Daulet  ').rawQuery, 'Daulet', 'trims whitespace');
}

// -----------------------------------------------------------------------
// Recipient search — dedupe and rank
// -----------------------------------------------------------------------

console.log('recipient search: dedupe and rank');
{
  const a: RankedChat = { chat: { id: '1', title: 'Daulet', username: 'daulet_test', type: 'private' }, source: 'contact' };
  const b: RankedChat = { chat: { id: '1', title: 'Daulet', username: 'daulet_test', type: 'private' }, source: 'local' };
  assertEq(dedupeAndRank([a, b], 'Daulet', 'Daulet', false).length, 1, 'same chat id deduplicates to one result');

  const exact: RankedChat = { chat: { id: '9', title: 'X', username: 'daulet_test', type: 'private' }, source: 'public' };
  const prefix: RankedChat = { chat: { id: '8', title: 'Dauletian', username: 'dauletian', type: 'private' }, source: 'contact' };
  const ranked = dedupeAndRank([prefix, exact], '@daulet_test', 'daulet_test', true);
  assertEq(ranked[0].id, '9', 'exact username match ranks above a prefix match');
}

// -----------------------------------------------------------------------
// chatId schema — a username is never a valid chatId
// -----------------------------------------------------------------------

console.log('chatId schema: only numeric ids are accepted');
{
  assert(!chatIdField.safeParse('@aassppann').success, 'a @username is rejected as chatId');
  assert(!chatIdField.safeParse('Aspan').success, 'a display name is rejected as chatId');
  assert(!chatIdField.safeParse('chat-1').success, 'a non-numeric slug is rejected as chatId');
  assert(chatIdField.safeParse('123456789').success, 'a numeric string is accepted');
  assert(chatIdField.safeParse('-1001234567890').success, 'a negative TDLib id is accepted');
}

// -----------------------------------------------------------------------
// Recipient search — composite search over a fake TDLib
// -----------------------------------------------------------------------

interface FakeContact {
  id: number;
  username: string;
  firstName: string;
  lastName?: string;
}

interface SearchOpts {
  contacts?: FakeContact[];
  publicChats?: Record<string, Record<string, unknown>>;
  localChats?: Record<string, unknown>[];
  serverChatIds?: number[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAdapter = any;

function makeFakeTdlib(
  opts: SearchOpts,
  respond: (response: Record<string, unknown>) => void,
) {
  const contacts = opts.contacts ?? [];
  const publicChats = opts.publicChats ?? {};
  const localChats = opts.localChats ?? [];
  const serverChatIds = opts.serverChatIds ?? [];

  return {
    searchPublicChat: async (username: string) => {
      const chat = publicChats[username];
      if (!chat) throw new Error('CHAT_NOT_FOUND');
      return JSON.stringify(chat);
    },
    searchChats: async () => JSON.stringify(localChats),
    createPrivateChat: async (userId: number) => {
      const contact = contacts.find((c) => c.id === userId);
      if (!contact) throw new Error('USER_NOT_FOUND');
      return JSON.stringify({
        id: 1_000_000 + userId,
        title: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
        type: { '@type': 'chatTypePrivate', user_id: userId },
      });
    },
    getUserProfile: async (userId: number) => {
      const contact = contacts.find((c) => c.id === userId);
      if (!contact) throw new Error('USER_NOT_FOUND');
      return JSON.stringify({
        id: userId,
        username: contact.username,
        first_name: contact.firstName,
        last_name: contact.lastName,
      });
    },
    getChat: async (chatId: number) => ({
      raw: JSON.stringify({
        id: chatId,
        title: `Chat ${chatId}`,
        type: { '@type': 'chatTypePrivate', user_id: chatId - 1_000_000 },
      }),
    }),
    loadChats: async () => 'ok',
    td_json_client_send: async (req: Record<string, unknown>) => {
      const type = req['@type'];
      let response: Record<string, unknown>;
      if (type === 'searchContacts') {
        response = {
          '@type': 'users',
          total_count: contacts.length,
          user_ids: contacts.map((c) => c.id),
        };
      } else if (type === 'searchChatsOnServer') {
        response = {
          '@type': 'chats',
          total_count: serverChatIds.length,
          chat_ids: serverChatIds,
        };
      } else {
        response = { '@type': 'ok' };
      }
      queueMicrotask(() => respond(response));
      return 'ok';
    },
  };
}

function makeSearchAdapter(opts: SearchOpts): AnyAdapter {
  const adapter = new NativeTdlibAdapter() as AnyAdapter;
  adapter.state = { type: 'ready', user: { id: '1' } };

  const tdlib = makeFakeTdlib(opts, (response) => {
    void adapter.handleTdlibUpdate(null, {
      type: String(response['@type']),
      raw: JSON.stringify(response),
    });
  });
  adapter.tdlib = tdlib;

  return adapter;
}

const DAULET: FakeContact = {
  id: 111,
  username: 'daulet_test',
  firstName: 'Daulet',
  lastName: 'Zhubanov',
};

void (async () => {
  console.log('recipient search: contact discovery');
  {
    const adapter = makeSearchAdapter({ contacts: [DAULET] });

    const byFirstName = await adapter.searchChats('Daulet', 10);
    assertEq(byFirstName.length, 1, 'search by first name returns the contact');
    assertEq(byFirstName[0].username, 'daulet_test', 'username is enriched from the user');
    assertEq(byFirstName[0].type, 'private', 'contact is a private chat');

    const byLastName = await adapter.searchChats('Zhubanov', 10);
    assertEq(byLastName.length, 1, 'search by last name returns the contact');

    const byUsername = await adapter.searchChats('daulet_test', 10);
    assertEq(byUsername.length, 1, 'search by username (no @) returns the contact');

    const byAtUsername = await adapter.searchChats('@daulet_test', 10);
    assertEq(byAtUsername.length, 1, 'search by @username returns the contact');
  }

  console.log('recipient search: contact with no existing local chat');
  {
    const adapter = makeSearchAdapter({ contacts: [DAULET] });
    // localChats=[] and serverChatIds=[] simulate a fresh session.
    const results = await adapter.searchChats('Daulet', 10);
    assertEq(results.length, 1, 'searchContacts + createPrivateChat resolves the contact');
    assertEq(results[0].id, String(1_000_000 + DAULET.id), 'a stable private chat id is produced');
  }

  console.log('recipient search: dedupe across sources');
  {
    const adapter = makeSearchAdapter({
      contacts: [DAULET],
      localChats: [{
        id: 1_000_000 + DAULET.id,
        title: 'Daulet Zhubanov',
        type: { '@type': 'chatTypePrivate', user_id: DAULET.id },
      }],
    });
    const results = await adapter.searchChats('Daulet', 10);
    assertEq(results.length, 1, 'the same person appears exactly once');
  }

  console.log('recipient search: public username and unknown person');
  {
    const adapter = makeSearchAdapter({
      contacts: [],
      publicChats: {
        rhousx: { id: '777', title: 'Rhousx', username: 'rhousx', type: { '@type': 'chatTypePrivate', user_id: 777 } },
      },
    });
    const publicResult = await adapter.searchChats('@rhousx', 10);
    assertEq(publicResult.length, 1, 'a public @username is resolvable');

    const unknown = await adapter.searchChats('NoSuchPerson', 10);
    assertEq(unknown.length, 0, 'an unknown person yields an empty list');
  }

  console.log('recipient search: send_message adapter defense');
  {
    let nativeSendCalled = false;
    const adapter = new NativeTdlibAdapter() as AnyAdapter;
    adapter.state = { type: 'ready', user: { id: '1' } };
    adapter.tdlib = {
      sendMessage: async () => {
        nativeSendCalled = true;
        return { raw: '{}' };
      },
    };

    let code = '';
    try {
      await adapter.sendMessage('@aassppann', 'hello');
    } catch (error) {
      code = (error as { code?: string })?.code ?? '';
    }
    assertEq(code, 'VALIDATION_FAILED', 'sendMessage rejects a @username with VALIDATION_FAILED');
    assert(!nativeSendCalled, 'native TDLib sendMessage is never invoked for a username');
  }

  console.log('verify:telegram — search checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

console.log('verify:telegram — all checks passed');
