import type { ConnectorId } from '@mobile-agent/connector-core';

/**
 * The connector catalogue shown on "Connect your services" and Account →
 * Connectors.
 *
 * RELEASE BUILD: three connectors, one row.
 *
 * On main this lists all fourteen entries from section 1 of
 * IMPLEMENT_ALL_CONNECTORS.md, which is right for development — the full
 * surface stays visible while it is built. It is wrong for a release. Of those
 * fourteen, only these three reach a real service today: the rest are mock
 * implementations or have no connector registered at all, so they render as
 * "Coming soon" tiles that a shipping app is simply advertising and cannot
 * honour.
 *
 * Cutting to three is also what makes the grid a single row of three at
 * COLUMNS = 3, with no short trailing row.
 *
 * `connectorId` is the id the connector registers under, so a tile maps
 * straight onto a ConnectionRecord. Availability is still resolved against the
 * live registry by ConnectorList, so shortening this list narrows what is
 * offered without ever widening it.
 *
 * To restore an entry, copy it back from main — the removed lines are intact
 * there, and this file is the only place they lived.
 */
export interface ConnectorCatalogEntry {
  key: string;
  label: string;
  /** The concrete capability, not marketing copy. */
  summary: string;
  connectorId?: ConnectorId;
  /** Shown instead of the summary when there is nothing to connect to. */
  note?: string;
}

export const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  { key: 'android', label: 'This device', summary: 'System settings and device controls', connectorId: 'android' },
  { key: 'google', label: 'Google', summary: 'Calendar, Gmail, Drive', connectorId: 'google' },
  { key: 'android', label: 'Settings', summary: 'This device', connectorId: 'android' },
  { key: 'telegram-user', label: 'Telegram', summary: 'Personal account', connectorId: 'telegram-user' },
  { key: 'google', label: 'Google', summary: 'Calendar and Drive', connectorId: 'google' },
];
