/**
 * SecureStore for verification scripts.
 *
 * The API client reads the access token through this. Nothing under test needs
 * a real token — the mapping functions never make a request — so this returns
 * none rather than pretending to be a keystore.
 */
export async function getItemAsync(_key: string): Promise<string | null> {
  return null;
}
export async function setItemAsync(_key: string, _value: string): Promise<void> {}
export async function deleteItemAsync(_key: string): Promise<void> {}
