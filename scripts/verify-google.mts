/**
 * Google connector verification:
 *
 * - redirect scheme/URI derivation from a single source of truth;
 * - sign-in unavailable without a configured client id;
 * - a completed grant persists its credential under a `credentialReference`
 *   pointer, preserves the external account id, and never stores a token on
 *   the record;
 * - two Google accounts coexist and disconnecting one leaves the other intact.
 *
 * Run: npm run verify:google
 */
import { GoogleConnector } from '@mobile-agent/connector-google';
import { InMemoryConnectionStore } from '@mobile-agent/connector-core';
import { InMemoryCredentialVault } from '@mobile-agent/credential-vault';
import type { OAuthCredential } from '@mobile-agent/credential-vault';

import { googleSchemeFromClientId } from '../src/connections/google/scheme.js';
import { isGoogleOAuthConfigured } from '../src/connections/google/config.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok — ${message}`);
}

function assertEq(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`FAIL: ${message} (expected ${String(expected)}, got ${String(actual)})`);
  }
  console.log(`  ok — ${message}`);
}

const CLIENT_ID = '113810819709-javkhtvie8tjsuph29flcoesr0h4sio6.apps.googleusercontent.com';
const SCHEME = 'com.googleusercontent.apps.113810819709-javkhtvie8tjsuph29flcoesr0h4sio6';

function fakeAuthorize(sub: string, email: string) {
  return async () => ({
    accessToken: `access-${sub}`,
    refreshToken: `refresh-${sub}`,
    accessTokenExpiresAt: Date.now() + 3_600_000,
    scopes: ['openid', 'email'],
    email,
    externalAccountId: sub,
  });
}

async function main(): Promise<void> {
  console.log('redirect scheme derivation:');
  {
    assertEq(
      googleSchemeFromClientId(CLIENT_ID),
      SCHEME,
      'client id → reverse-DNS redirect scheme',
    );
    assertEq(
      `${googleSchemeFromClientId(CLIENT_ID)}:/oauth2redirect`,
      `${SCHEME}:/oauth2redirect`,
      'client id → redirect URI',
    );
    assert(
      isGoogleOAuthConfigured() === false,
      'sign-in is unavailable when EXPO_PUBLIC_OAUTH is not set (test env)',
    );
  }

  console.log('token persistence and credentialReference:');
  {
    const store = new InMemoryConnectionStore();
    const vault = new InMemoryCredentialVault();
    const connector = new GoogleConnector({
      store,
      vault,
      authorize: fakeAuthorize('account-A', 'a@example.com'),
      revoke: async () => {},
    });

    const record = await connector.connect();

    assertEq(record.id, 'google:account-A', 'connection id follows the Google sub');
    assertEq(record.externalAccountId, 'account-A', 'externalAccountId is preserved');
    assert(
      typeof record.credentialReference === 'string' &&
        record.credentialReference.length > 0,
      'record carries a credentialReference pointer',
    );
    assert(
      !('accessToken' in record) && !('refreshToken' in record),
      'no token is stored on the ConnectionRecord',
    );

    const cred = (await vault.get(record.credentialReference!)) as OAuthCredential | null;
    assert(cred?.kind === 'oauth', 'the OAuth grant is stored in the vault');
    assertEq(cred?.accessToken, 'access-account-A', 'vault credential matches the grant');
  }

  console.log('multi-account coexistence and isolation:');
  {
    const store = new InMemoryConnectionStore();
    const vault = new InMemoryCredentialVault();

    const connectA = new GoogleConnector({
      store,
      vault,
      authorize: fakeAuthorize('account-A', 'a@example.com'),
      revoke: async () => {},
    });
    const connectB = new GoogleConnector({
      store,
      vault,
      authorize: fakeAuthorize('account-B', 'b@example.com'),
      revoke: async () => {},
    });

    const a = await connectA.connect();
    const b = await connectB.connect();

    assertEq((await store.list()).length, 2, 'two connection records exist');
    assertEq(a.id, 'google:account-A', 'account A has its own id');
    assertEq(b.id, 'google:account-B', 'account B has its own id');
    assert(
      (await vault.get('google.oauth:google:account-A')) !== null &&
        (await vault.get('google.oauth:google:account-B')) !== null,
      'two distinct credentials are stored',
    );

    // Disconnecting A must not touch B's record or credential.
    await connectA.disconnect(a.id);

    assert(
      (await store.get(a.id)) === null,
      'disconnecting A removes its record',
    );
    assert(
      (await vault.get('google.oauth:google:account-A')) === null,
      'disconnecting A removes its credential',
    );
    assert(
      (await store.get(b.id)) !== null,
      'B\'s record is untouched',
    );
    assert(
      (await vault.get('google.oauth:google:account-B')) !== null,
      'B\'s credential is untouched',
    );
  }

  console.log('verify:google — all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
