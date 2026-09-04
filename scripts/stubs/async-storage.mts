/**
 * In-memory AsyncStorage for verification scripts.
 *
 * Aliased in for `verify:custom-mcp` so the store's real logic runs under Node
 * without a device. Only the four methods the store uses are implemented; an
 * unimplemented one should fail loudly rather than silently no-op.
 */
const store = new Map<string, string>();

export default {
  getItem: async (key: string): Promise<string | null> => store.get(key) ?? null,
  setItem: async (key: string, value: string): Promise<void> => {
    store.set(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    store.delete(key);
  },
  clear: async (): Promise<void> => {
    store.clear();
  },
};
