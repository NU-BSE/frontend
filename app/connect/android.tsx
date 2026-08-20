import React, { useEffect } from 'react';
import { AppState, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import {
  useConnectConnector,
  useConnection,
  useDisconnectConnection,
} from '@/connections/useConnections';
import { useAndroidDeviceAccess } from '@/connections/android/useAndroidDeviceAccess';
import {
  requestOverlayPermission,
  requestWriteSystemSettingsPermission,
} from '@/connections/android/device-access';
import { gutter, palette, radius, spacing } from '@/theme/tokens';

/**
 * Production Account UI for the on-device Android connector.
 *
 * Connect/disconnect here only; Android system permissions are never toggled
 * automatically — the "Allow"/"Manage" buttons open the relevant Android
 * Settings screen and the state re-reads live on return to foreground.
 */
export default function AndroidConnectScreen() {
  const { connection } = useConnection('android');
  const connect = useConnectConnector();
  const disconnect = useDisconnectConnection();
  const access = useAndroidDeviceAccess();

  // When the app returns to the foreground, re-sync the connection record so
  // `scopes` reflect any permission the user just granted/revoked. `connect()`
  // is idempotent: it refreshes the single `android-device` record in place.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (connection) void connect.mutateAsync('android');
    });
    return () => subscription.remove();
  }, [connection, connect]);

  const connected = connection?.status === 'connected';
  const state = access.data;

  const error =
    connect.error instanceof Error
      ? connect.error.message
      : disconnect.error instanceof Error
        ? disconnect.error.message
        : null;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="display">This device</Text>
        <Text variant="bodyLarge" tone="secondary">
          Allow Creepy to read and control supported Android settings on this
          device.
        </Text>

        <View style={styles.card}>
          <Row label="Device" value={state?.device ? `${state.device.manufacturer} ${state.device.model}` : '—'} />
          <Row label="Connector" value={connected ? 'Connected' : 'Not connected'} highlight={connected} />
          <Row label="Native integration" value={state?.nativeAvailable ? 'Available' : 'Unavailable'} highlight={state?.nativeAvailable} danger={!state?.nativeAvailable} />
        </View>

        {!state?.nativeAvailable ? (
          <Text variant="body" tone="danger">
            The native Android settings bridge is unavailable in this build.
            Rebuild the app with the native module included.
          </Text>
        ) : connected ? (
          <View style={styles.section}>
            <Text variant="headline">Connection</Text>
            <View style={styles.card}>
              <Row label="Status" value="Connected" highlight />
              <Row label="Device" value={connection?.displayName ?? '—'} />
              <Row
                label="Scopes"
                value={connection?.scopes?.length ? connection.scopes.join(', ') : '—'}
              />
            </View>
            <Button
              label="Disconnect device connector"
              variant="secondary"
              loading={disconnect.isPending}
              onPress={() => {
                if (connection) void disconnect.mutateAsync(connection.id);
              }}
            />
            <Text variant="bodySmall" tone="muted">
              Disconnecting Creepy disables the connector but does not revoke
              Android permissions already granted in system settings.
            </Text>
          </View>
        ) : (
          <View style={styles.section}>
            <Text variant="headline">Connection</Text>
            <Button
              label="Connect this device"
              loading={connect.isPending}
              onPress={() => void connect.mutateAsync('android')}
            />
          </View>
        )}

        {state?.nativeAvailable ? (
          <View style={styles.section}>
            <Text variant="headline">Device access</Text>
            <Text variant="bodySmall" tone="muted">
              Required access {state.writeSettings ? '1 / 1' : '0 / 1'} · Optional
              access {state.overlay ? '1 / 1' : '0 / 1'}
            </Text>

            <View style={styles.card}>
              <AccessRow
                title="Read system settings"
                status="Available"
                description="Allows Creepy to read supported device settings."
              />
              <AccessRow
                title="Modify system settings"
                status={state.writeSettings ? 'Allowed' : 'Not allowed'}
                allowed={state.writeSettings}
                description="Required to change brightness, screen timeout and auto-rotate."
                actionLabel={state.writeSettings ? 'Manage' : 'Allow'}
                onAction={() => void requestWriteSystemSettingsPermission()}
              />
              <AccessRow
                title="Display over other apps"
                status={state.overlay ? 'Allowed' : 'Not allowed'}
                allowed={state.overlay}
                description="Optional device access for future on-screen Creepy controls."
                actionLabel={state.overlay ? 'Manage' : 'Allow'}
                onAction={() => void requestOverlayPermission()}
              />
            </View>

            <Text variant="bodySmall" tone="muted">
              Overlay is optional — settings tools work without it. Permission
              changes take effect after you return from the Android settings
              screen.
            </Text>
          </View>
        ) : null}

        {error ? (
          <Text variant="bodySmall" tone="danger" style={styles.error}>
            {error}
          </Text>
        ) : null}

        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

function Row({
  label,
  value,
  highlight,
  danger,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  danger?: boolean;
}) {
  return (
    <View style={styles.cardRow}>
      <Text variant="bodySmall" tone="muted">
        {label}
      </Text>
      <Text
        variant="labelSmall"
        tone={danger ? 'danger' : highlight ? 'brand' : 'secondary'}
        style={styles.value}
      >
        {value}
      </Text>
    </View>
  );
}

function AccessRow({
  title,
  status,
  description,
  allowed,
  actionLabel,
  onAction,
}: {
  title: string;
  status: string;
  description: string;
  allowed?: boolean;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.accessRow}>
      <View style={styles.accessHeader}>
        <Text variant="label">{title}</Text>
        <Text variant="tag" tone={allowed ? 'brand' : 'secondary'} uppercase>
          {status}
        </Text>
      </View>
      <Text variant="bodySmall" tone="secondary">
        {description}
      </Text>
      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          variant={allowed ? 'ghost' : 'secondary'}
          onPress={onAction}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: gutter.screen,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  section: { gap: spacing.md },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  value: { flexShrink: 1, textAlign: 'right' },
  accessRow: { gap: spacing.xs },
  accessHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  error: { textAlign: 'center' },
});
