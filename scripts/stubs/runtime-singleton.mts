/**
 * A real in-memory credential vault for verification scripts.
 *
 * Not a no-op: the store's guarantee is that removing a server deletes the
 * secrets it owns, and only a vault that actually holds values can show that
 * it happened.
 */
interface StoredCredential {
  kind: string;
  token?: string;
}

const entries = new Map<string, StoredCredential>();

export function getCredentialVault() {
  return {
    save: async (reference: string, credential: StoredCredential): Promise<void> => {
      entries.set(reference, credential);
    },
    get: async (reference: string): Promise<StoredCredential | null> =>
      entries.get(reference) ?? null,
    remove: async (reference: string): Promise<void> => {
      entries.delete(reference);
    },
  };
}

/** Test-only window into the vault, so assertions can check what survived. */
export function __vaultReferences(): string[] {
  return [...entries.keys()].sort();
}
