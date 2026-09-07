import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { Text } from '@/components/Text';
import {
  buildConnectorCatalog,
  customServersLabel,
  CUSTOM_SERVERS_ENTRY,
  type ConnectorCatalogEntry,
} from '@/features/connections/catalog';
import { useCustomServers } from '@/mcp/custom/useCustomServers';
import { hasResolverHost } from '@/mcp/custom/resolverClient';
import { chunkRows } from '@/features/scenarios/chunkRows';
import {
  useConnectConnector,
  useConnections,
  useDisconnectConnection,
  useRegisteredConnectorIds,
} from '@/connections/useConnections';
import { palette, radius, spacing } from '@/theme/tokens';

const COLUMNS = 3;
const GRID_GAP = spacing.md;

/**
 * The connector catalogue shared by onboarding and Account → Connectors.
 *
 * State comes from the persistent ConnectionStore via TanStack Query — a tap
 * never fakes a connection. "Connected" reflects a real ConnectionRecord and
 * a second tap disconnects; connecting runs the connector's actual auth flow
 * and surfaces its error verbatim when there isn't one yet.
 *
 * Columns are structural: explicit rows of `flex: 1` cells rather than
 * `flexWrap`. Wrapping derives the column count from measured width, so a rule
 * that overflows by a fraction of a point silently collapses the grid to one
 * column — which this screen family has already shipped twice. Three cells
 * plus two gaps leave less slack than two, so the risk is higher here.
 * `verify:layout` runs Yoga over this exact tree across eight device widths.
 */
export function ConnectorList() {
  const { data: connections, isPending } = useConnections();
  const { data: registeredIds } = useRegisteredConnectorIds();
  const connect = useConnectConnector();
  const disconnect = useDisconnectConnection();
  const { data: customServers } = useCustomServers();

  /*
   * Shown as a count rather than a dot or a badge: "Custom" alone gives no
   * hint whether anything is behind it, and the number is the one fact worth
   * carrying on a tile this small. Pending reads as 0 rather than blank, so
   * the label does not change width as the query settles.
   */
  const customLabel = customServersLabel(customServers?.length ?? 0);

  /*
   * Host availability is a build-time constant, so this is computed once. It
   * is read through the catalogue builder rather than by appending a tile here
   * so that `verify:layout` measures the same two shapes this renders.
   */
  const rows = useMemo(() => {
    const entries = buildConnectorCatalog({ customServers: hasResolverHost() });
    const tiles = entries.filter((entry) => !entry.fullWidth);
    const banners = entries.filter((entry) => entry.fullWidth);
    /*
     * Full-width entries get their own unpadded row. Padding is what keeps a
     * short final row's cells the same width as a full one, so *not* padding
     * is what lets a single cell span the content width.
     */
    return [...chunkRows(tiles, COLUMNS), ...banners.map((entry) => [entry])];
  }, []);

  const failed =
    disconnect.isError
      ? {
          message:
            disconnect.error instanceof Error
              ? disconnect.error.message
              : 'Could not disconnect',
        }
      : connect.isError
        ? {
            message:
              connect.error instanceof Error
                ? connect.error.message
                : 'Could not connect',
          }
        : null;

  return (
    <View style={styles.wrapper}>
      <View style={styles.grid}>
        {rows.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={styles.row}>
            {row.map((entry: ConnectorCatalogEntry | null, columnIndex) => {
              if (!entry) {
                // Keeps a short final row's cells at full width instead of
                // stretching them across the row.
                return (
                  <View
                    key={`spacer-${rowIndex}-${columnIndex}`}
                    style={styles.cellSlot}
                  />
                );
              }

              const connection = entry.connectorId
                ? connections?.find(
                    (record) => record.connectorId === entry.connectorId,
                  )
                : undefined;

              const connectorConnections = entry.connectorId
                ? connections?.filter(
                    (record) => record.connectorId === entry.connectorId,
                  ) ?? []
                : [];

              const hasConnections = connectorConnections.length > 0;

              const connected = connectorConnections.some(
                (record) => record.status === 'connected',
              );

              const reconnectRequired = connectorConnections.some(
                (record) => record.status === 'reconnect_required',
              );

              // Availability comes from the live registry, not the catalogue:
              // a connector the registry omitted is "Coming soon", not tappable.
              const available = entry.connectorId
                ? registeredIds?.has(entry.connectorId) ?? false
                : false;
              // A route-only entry opens a screen, so it is tappable without a
              // registered connector behind it.
              const connectable = entry.route
                ? true
                : Boolean(entry.connectorId) && available;
              const busy =
                (connect.isPending && connect.variables === entry.connectorId) ||
                (disconnect.isPending && disconnect.variables === connection?.id);
              const canPress = hasConnections || connectable;

              return (
                <Pressable
                  key={entry.key}
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: !canPress || busy || isPending,
                    selected: connected,
                  }}
                  accessibilityLabel={
                    entry.route
                      ? `${entry.key === CUSTOM_SERVERS_ENTRY.key ? customLabel : entry.label}. ${entry.summary}`
                      : connectable
                      ? `${entry.label}. ${
                          entry.connectorId === 'android'
                            ? connected
                              ? 'Connected. Tap to manage'
                              : entry.summary
                            : connected
                              ? 'Connected. Tap to disconnect'
                              : reconnectRequired
                                ? 'Reconnect required. Tap to reconnect'
                                : entry.summary
                        }`
                      : `${entry.label}. ${entry.note ?? 'Coming soon'}`
                  }
                  disabled={!canPress || busy || isPending}
                  onPress={() => {
                    if (entry.route) {
                      router.push(entry.route as Parameters<typeof router.push>[0]);
                      return;
                    }
                    if (!entry.connectorId) return;
                    // Android is a special connector: tapping it always opens
                    // its dedicated screen (connect, permissions, disconnect),
                    // never an inline disconnect.
                    if (entry.connectorId === 'android') {
                      router.push('/connect/android');
                      return;
                    }
                    if (connectorConnections.length > 0) {
                      void (async () => {
                        for (const record of connectorConnections) {
                          await disconnect.mutateAsync(record.id);
                        }
                      })();

                      return;
                    } else if (entry.connectorId === 'telegram-user') {
                      router.push('/connect/telegram');
                    } else if (entry.connectorId === 'google') {
                      router.push('/connect/google');
                    } else {
                      connect.mutate(entry.connectorId);
                    }
                  }}
                  style={({ pressed }) => [
                    styles.cellSlot,
                    styles.cell,
                    connected && styles.cellConnected,
                    !connectable && styles.cellPlanned,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    variant="label"
                    tone={!connectable ? 'faint' : connected ? 'brand' : 'primary'}
                    style={styles.cellText}
                    numberOfLines={2}
                  >
                    {entry.key === CUSTOM_SERVERS_ENTRY.key ? customLabel : entry.label}
                  </Text>
                  <Text
                    variant="bodySmall"
                    tone={connectable ? 'secondary' : 'faint'}
                    style={styles.cellText}
                    numberOfLines={2}
                  >
                    {busy
                      ? 'Working…'
                      : connected
                        ? (connection?.displayName ?? 'Connected')
                        : reconnectRequired
                          ? 'Reconnect required'
                          : (entry.note ?? entry.summary)}
                  </Text>
                  {connected ? (
                    <Text variant="tag" tone="brand" uppercase>
                      Connected
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      {failed ? (
        <Text
          accessibilityLiveRegion="polite"
          variant="bodySmall"
          tone="danger"
          style={styles.message}
        >
          {failed.message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.md },
  grid: { gap: GRID_GAP },
  row: { flexDirection: 'row', gap: GRID_GAP },
  cellSlot: { flex: 1, minWidth: 0 },
  cell: {
    minHeight: 104,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
  },
  cellConnected: {
    borderColor: palette.brand,
    backgroundColor: palette.brandWash,
  },
  cellPlanned: { backgroundColor: palette.canvas },
  cellText: { textAlign: 'center' },
  pressed: { opacity: 0.8 },
  message: { textAlign: 'center' },
});
