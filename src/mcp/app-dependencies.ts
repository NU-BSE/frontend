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
  return `creepyim.credential.${reference.replace(/[^A-Za-z0-9._-]/gu, '_')}`;
}

class SecureStoreCredentialVault implements CredentialVault {
  async save(reference: string, credential: StoredCredential): Promise<void> {
    await SecureStore.setItemAsync(vaultKey(reference), JSON.stringify(credential));
  }

  async get(reference: string): Promise<StoredCredential | null> {
    const raw = await SecureStore.getItemAsync(vaultKey(reference));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredCredential;
    } catch {
      return null;
    }
  }

  async remove(reference: string): Promise<void> {
    await SecureStore.deleteItemAsync(vaultKey(reference));
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
