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
  /**
   * Route to open instead of running a connector's auth flow.
   *
   * An entry with a route is always tappable: availability for a connector is
   * derived from the live registry, but a screen has no registry entry and
   * would otherwise render as "Coming soon".
   */
  route?: string;
  /**
   * Give this entry a row to itself, spanning the full content width.
   *
   * The grid is three columns and a short final row is padded with spacers so
   * its cells keep the width they have in a full row. That is right for a
   * connector — a lone tile stretched across the screen reads as a different
   * kind of thing from the ones above it — and wrong for an entry that *is* a
   * different kind of thing.
   */
  fullWidth?: boolean;
  /**
   * Available without a subscription.
   *
   * The line is drawn at the device boundary rather than by naming tiles:
   * Settings is the phone the user already owns, and everything else reaches
   * a service off it. Marking the exception keeps the rule in one place, so a
   * connector added later is behind the paywall by default rather than
   * because someone remembered to add it to a list.
   */
  includedOnFreePlan?: boolean;
}

export const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  {
    key: 'android',
    label: 'Settings',
    summary: 'This device',
    connectorId: 'android',
    includedOnFreePlan: true,
  },
  { key: 'telegram-user', label: 'Telegram', summary: 'Personal account', connectorId: 'telegram-user' },
  { key: 'google', label: 'Google', summary: 'Calendar, Gmail, Drive', connectorId: 'google' },
];

/**
 * User-added MCP servers.
 *
 * Not a connector: there is no id, no registry entry and no auth flow, just a
 * screen. It carries a `route` for that reason.
 */
/**
 * The custom tile's label, which carries its count.
 *
 * Lives here with the entry rather than in the grid, so the copy for a tile
 * and the tile itself stay in one place.
 */
export function customServersLabel(count: number): string {
  return `Custom (${count} added)`;
}

export const CUSTOM_SERVERS_ENTRY: ConnectorCatalogEntry = {
  key: 'custom-mcp',
  label: 'Custom',
  summary: 'Your own MCP servers',
  route: '/connect/custom',
  fullWidth: true,
};

/**
 * The catalogue as rendered.
 *
 * The custom-server tile appears only when a backend is configured, because
 * translating a server needs one. Without it the screen behind the tile can do
 * nothing but explain why, and this catalogue's whole reason for being short
 * is that a shipping app should not advertise what it cannot honour.
 *
 * Adding the tile also changes the grid from one row of three to two rows, so
 * `verify:layout` runs Yoga over both shapes rather than only the shorter one.
 */
export function buildConnectorCatalog(options: {
  customServers: boolean;
}): ConnectorCatalogEntry[] {
  return options.customServers
    ? [...CONNECTOR_CATALOG, CUSTOM_SERVERS_ENTRY]
    : [...CONNECTOR_CATALOG];
}
