import type {
  CredentialVault,
  StoredCredential,
} from './types';

export class InMemoryCredentialVault implements CredentialVault {
  private readonly store = new Map<string, StoredCredential>();

  async save(reference: string, credential: StoredCredential): Promise<void> {
    this.store.set(reference, credential);
  }

  async get(reference: string): Promise<StoredCredential | null> {
    return this.store.get(reference) ?? null;
  }

  async remove(reference: string): Promise<void> {
    this.store.delete(reference);
  }
}
