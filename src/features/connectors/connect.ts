import type { ConnectorEntry } from '@/features/connectors/catalog';

/**
 * What to say when a user taps a connector.
 *
 * Connecting a service needs three things that do not exist yet: a way to open
 * an authorization page (no `expo-web-browser` / `expo-auth-session` is
 * installed), a backend endpoint to exchange the code and hold the tokens (the
 * API serves only `/auth/email/*`, `/users`, `/subscriptions` and `/admin`),
 * and somewhere to persist the resulting connection. `packages/oauth-core`
 * has PKCE helpers ready for that flow but is imported nowhere.
 *
 * Until then the honest behaviour is to say so. The previous version toggled a
 * label to "Connected", which claimed an account link that did not exist —
 * and would have let the agent believe it could act on that service.
 */
export function connectUnavailableMessage(entry: ConnectorEntry): string {
  if (entry.status === 'planned') {
    return `${entry.label} is not implemented yet.`;
  }
  return (
    `${entry.label} tools are ready, but sign-in is not wired up yet — ` +
    'connecting an account needs the OAuth flow from IMPLEMENT_ALL_CONNECTORS.md.'
  );
}
