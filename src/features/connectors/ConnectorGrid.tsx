import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import {
  CONNECTOR_CATALOG,
  isConnectable,
  type ConnectorEntry,
} from '@/features/connectors/catalog';
import { chunkRows } from '@/features/scenarios/chunkRows';
import { palette, radius, spacing } from '@/theme/tokens';

const COLUMNS = 3;
const GRID_GAP = spacing.md;

export interface ConnectorGridProps {
  /** Ids currently connected. Empty until a real OAuth flow can populate it. */
  connectedIds: ReadonlySet<string>;
  onConnect: (entry: ConnectorEntry) => void;
  entries?: ConnectorEntry[];
}

/**
 * The connector catalogue as a three-across grid.
 *
 * Shared by onboarding and the account screen so the two cannot drift; they
 * differ only in what they do with a tap.
 *
 * Columns are structural — explicit rows of `flex: 1` cells rather than
 * `flexWrap`. Wrapping derives the column count from measured width, so a rule
 * that overflows by a fraction of a point silently collapses the grid to one
 * column, which this screen family has already shipped twice. Three cells plus
 * two gaps leave less slack than two, so the risk is higher here, not lower.
 * `verify:layout` runs Yoga over this exact tree across eight device widths.
 */
export function ConnectorGrid({
  connectedIds,
  onConnect,
  entries = CONNECTOR_CATALOG,
}: ConnectorGridProps) {
  const rows = useMemo(() => chunkRows(entries, COLUMNS), [entries]);

  return (
    <View style={styles.grid}>
      {rows.map((row, rowIndex) => (
        <View key={`row-${rowIndex}`} style={styles.row}>
          {row.map((entry, columnIndex) => {
            if (!entry) {
              // Keeps a short final row's cells at full width rather than
              // stretching them across the row.
              return (
                <View
                  key={`spacer-${rowIndex}-${columnIndex}`}
                  style={styles.cellSlot}
                />
              );
            }

            const connectable = isConnectable(entry);
            const connected = connectedIds.has(entry.id);

            return (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityState={{
                  disabled: !connectable,
                  selected: connected,
                }}
                accessibilityLabel={
                  connectable
                    ? `${entry.label}. ${entry.summary}`
                    : `${entry.label}. Coming soon`
                }
                disabled={!connectable}
                onPress={() => onConnect(entry)}
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
                  {connectable ? entry.summary : 'Coming soon'}
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
  );
}

const styles = StyleSheet.create({
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
});
