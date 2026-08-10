import React from 'react';
import { StyleSheet, View } from 'react-native';

import { AUTH_PROVIDERS } from '@/auth/providers';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import {
  useConnectConnector,
  useConnections,
  useDisconnectConnection,
} from '@/connections/useConnections';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

/**
 * The connector list shared by onboarding and Account → Connectors.
 *
 * State comes from the persistent ConnectionStore via TanStack Query — a tap
 * never fakes a connection. "Connected" shows the real account identity and
 * offers Disconnect; connecting runs the connector's actual auth flow.
 */
export function ConnectorList() {
  const { data: connections, isPending } = useConnections();
  const connect = useConnectConnector();
  const disconnect = useDisconnectConnection();

  return (
    <View style={styles.card}>
      {AUTH_PROVIDERS.map((provider) => {
        const connection = provider.connectorId
          ? connections?.find(
              (record) =>
                record.connectorId === provider.connectorId &&
                record.status === 'connected',
            )
          : undefined;

        const connected = Boolean(connection);
        const isBusy =
          (connect.isPending && connect.variables === provider.connectorId) ||
          (disconnect.isPending &&
            disconnect.variables === connection?.id);

        const shortLabel = provider.label.replace(/^Connect /u, '');
        const label = connected
          ? `${shortLabel} — Connected`
          : provider.label;

        return (
          <View key={provider.id} style={styles.provider}>
            <Button
              label={label}
              variant={connected ? 'primary' : 'secondary'}
              disabled={!provider.enabled || isBusy || isPending}
              loading={isBusy}
              onPress={() => {
                if (connected && connection) {
                  disconnect.mutate(connection.id);
                } else if (provider.connectorId) {
                  connect.mutate(provider.connectorId);
                }
              }}
            />
            {connected && connection ? (
              <Text variant="bodySmall" tone="muted" style={styles.note}>
                {connection.displayName} · {connection.status}
              </Text>
            ) : null}
            {!provider.enabled && provider.note ? (
              <Text variant="bodySmall" tone="muted" style={styles.note}>
                {provider.note}
              </Text>
            ) : null}
            {connect.isError &&
            connect.variables === provider.connectorId ? (
              <Text variant="bodySmall" tone="danger" style={styles.note}>
                {connect.error instanceof Error
                  ? connect.error.message
                  : 'Could not connect'}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    ...shadow.card,
  },
  provider: { gap: spacing.xs },
  note: { paddingHorizontal: spacing.xs },
});
