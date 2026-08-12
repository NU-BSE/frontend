import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  PersistentConnectionStore,
  type KeyValueBackend,
} from '@mobile-agent/connector-core';
import {
  InMemoryCredentialVault,
  type CredentialVault,
  type StoredCredential,
} from '@mobile-agent/credential-vault';

import { configureAppDependencies } from './runtime-singleton';

/**
 * App production wiring for the MCP layer (registered once at startup):
 *
 * - connections persist across restarts in AsyncStorage — metadata only,
 *   never secrets (`credentialReference` is a pointer, not a credential);
 * - credentials live in expo-secure-store, which is backed by the Android
 *   Keystore on-device. No access token ever touches AsyncStorage, React
 *   state, or logs.
 *
 * Verification scripts never import this module; they get in-memory
 * fallbacks from the runtime singleton.
 */

const asyncStorageBackend: KeyValueBackend = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

/** SecureStore keys allow only [A-Za-z0-9._-]. */
function vaultKey(reference: string): string {
  return `creepyim.credential.${base64UrlEncode(reference)}`;
}

/**
 * Collision-resistant encoding for credential references.
 *
 * The old `reference.replace(/[^A-Za-z0-9._-]/g, '_')` was lossy: distinct
 * references (e.g. `a/b` and `a_b`) could collapse to the same SecureStore
 * key and clobber each other. base64url is bijective for the ASCII references
 * the app produces, so two references can never share a key.
 */
function base64UrlEncode(input: string): string {
  const B64 =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code > 0xff) {
      // References are ASCII by construction; fail loudly rather than emit a
      // lossy encoding that could collide.
      throw new Error(`credential reference must be ASCII: ${input}`);
    }
    bytes.push(code);
  }

  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 0x3f] : '=';
  }
  return out.replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

/** The pre-migration lossy key, kept so existing credentials stay reachable. */
function legacyVaultKey(reference: string): string {
  return `creepyim.credential.${reference.replace(/[^A-Za-z0-9._-]/gu, '_')}`;
}

class SecureStoreCredentialVault implements CredentialVault {
  async save(reference: string, credential: StoredCredential): Promise<void> {
    await SecureStore.setItemAsync(vaultKey(reference), JSON.stringify(credential));
  }

  async get(reference: string): Promise<StoredCredential | null> {
    const key = vaultKey(reference);
    const raw = await SecureStore.getItemAsync(key);
    if (raw) {
      const parsed = this.parse(reference, raw);
      if (parsed) return parsed;
    }

    // Migration: credentials written before the collision-resistant key was
    // introduced live under the lossy key. Read once, then re-save under the
    // new key and drop the legacy entry.
    const legacy = legacyVaultKey(reference);
    if (legacy !== key) {
      const legacyRaw = await SecureStore.getItemAsync(legacy);
      if (legacyRaw) {
        const parsed = this.parse(reference, legacyRaw);
        if (parsed) {
          await SecureStore.setItemAsync(key, JSON.stringify(parsed));
          await SecureStore.deleteItemAsync(legacy);
          return parsed;
        }
      }
    }

    return null;
  }

  async remove(reference: string): Promise<void> {
    await SecureStore.deleteItemAsync(vaultKey(reference));
    await SecureStore.deleteItemAsync(legacyVaultKey(reference));
  }

  /** Returns null (and quarantines the entry) when JSON cannot be parsed. */
  private parse(reference: string, raw: string): StoredCredential | null {
    try {
      return JSON.parse(raw) as StoredCredential;
    } catch {
      // A corrupted entry must not be parsed on every request forever.
      void SecureStore.deleteItemAsync(vaultKey(reference));
      void SecureStore.deleteItemAsync(legacyVaultKey(reference));
      return null;
    }
  }
}

let registered = false;

export function registerAppMcpDependencies(): void {
  if (registered) return;
  registered = true;

  configureAppDependencies({
    connectionStore: new PersistentConnectionStore(asyncStorageBackend),
    // SecureStore is native-only; web previews degrade to in-memory.
    credentialVault:
      Platform.OS === 'web'
        ? new InMemoryCredentialVault()
        : new SecureStoreCredentialVault(),
  });
}
