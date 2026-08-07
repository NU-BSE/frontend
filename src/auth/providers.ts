/**
 * Auth provider registry.
 *
 * Each provider connects to an external service through the backend API.
 * OAuth tokens are stored on the backend — the frontend only holds a
 * connection reference.
 */
export type ProviderId = 'telegram' | 'google' | 'facebook' | 'apple';

export interface AuthProvider {
  id: ProviderId;
  label: string;
  enabled: boolean;
  note?: string;
  /** Backend connector id for connect/disconnect API calls. */
  connectorId?: string;
}

export const AUTH_PROVIDERS: AuthProvider[] = [
  {
    id: 'google',
    label: 'Continue with Google',
    enabled: true,
    connectorId: 'google-calendar',
  },
  {
    id: 'telegram',
    label: 'Continue with Telegram',
    enabled: true,
    connectorId: 'telegram',
  },
  {
    id: 'facebook',
    label: 'Continue with Facebook',
    enabled: false,
    note: 'Coming soon',
  },
  {
    id: 'apple',
    label: 'Continue with Apple',
    enabled: false,
    note: 'Coming soon',
  },
];
