import type { ConnectorId } from '@mobile-agent/connector-core';

/**
 * Auth provider registry.
 *
 * Each entry maps a UI-facing provider to the connector that owns its
 * connection. Connection state is read from the shared persistent
 * ConnectionStore — never from local component state — so "Connected" always
 * means a real, authorized account.
 */
export type ProviderId = 'telegram' | 'google' | 'facebook' | 'apple';

export interface AuthProvider {
  id: ProviderId;
  label: string;
  enabled: boolean;
  note?: string;
  /** Connector that owns this connection. */
  connectorId?: ConnectorId;
}

export const AUTH_PROVIDERS: AuthProvider[] = [
  {
    id: 'telegram',
    label: 'Connect Telegram',
    enabled: true,
    connectorId: 'telegram-user',
  },
  {
    id: 'google',
    label: 'Connect Google',
    enabled: true,
    connectorId: 'google',
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
