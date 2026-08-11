import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import {
  CONNECTOR_CATALOG,
  type ConnectorCatalogEntry,
} from '@/features/connections/catalog';
import { chunkRows } from '@/features/scenarios/chunkRows';
import {
  useConnectConnector,
  useConnections,
  useDisconnectConnection,
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
  const connect = useConnectConnector();
  const disconnect = useDisconnectConnection();

  const rows = useMemo(() => chunkRows(CONNECTOR_CATALOG, COLUMNS), []);

  const failed =
    connect.isError && typeof connect.variables === 'string'
      ? {
          connectorId: connect.variables,
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
                    (record) =>
                      record.connectorId === entry.connectorId &&
                      record.status === 'connected',
                  )
                : undefined;

              const connected = Boolean(connection);
              const connectable = Boolean(entry.connectorId);
              const busy =
                (connect.isPending && connect.variables === entry.connectorId) ||
                (disconnect.isPending && disconnect.variables === connection?.id);

              return (
                <Pressable
                  key={entry.key}
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: !connectable || busy || isPending,
                    selected: connected,
                  }}
                  accessibilityLabel={
                    connectable
                      ? `${entry.label}. ${connected ? 'Connected. Tap to disconnect' : entry.summary}`
                      : `${entry.label}. ${entry.note ?? 'Unavailable'}`
                  }
                  disabled={!connectable || busy || isPending}
                  onPress={() => {
                    if (connected && connection) disconnect.mutate(connection.id);
                    else if (entry.connectorId) connect.mutate(entry.connectorId);
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
                    {entry.label}
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
