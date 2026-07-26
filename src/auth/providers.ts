/**
 * Auth provider registry.
 *
 * Screen 3 is currently a stub by design — but the shape below is what the
 * real integrations plug into, so adding Telegram/Google/Facebook later means
 * implementing `signIn` and flipping `enabled`, not rewriting the screen.
 *
 * Each provider will use `expo-auth-session` (Google, Facebook) or the
 * Telegram Login widget via a deep link back to the `creepyim://` scheme.
 * Tokens belong in `expo-secure-store`, never AsyncStorage.
 */
export type ProviderId = 'telegram' | 'google' | 'facebook' | 'apple';

export interface AuthProvider {
  id: ProviderId;
  label: string;
  /** Flip once the integration is implemented and its config is present. */
  enabled: boolean;
  /** Why it is unavailable — shown to the user instead of a dead button. */
  note?: string;
}

export const AUTH_PROVIDERS: AuthProvider[] = [
  {
    id: 'telegram',
    label: 'Continue with Telegram',
    enabled: false,
    note: 'Needs a bot token and a deep-link callback',
  },
  {
    id: 'google',
    label: 'Continue with Google',
    enabled: false,
    note: 'Needs an OAuth client ID for the Android package',
  },
  {
    id: 'facebook',
    label: 'Continue with Facebook',
    enabled: false,
    note: 'Needs a Facebook app ID and key hash',
  },
];
