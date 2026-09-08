import React, { useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
import { useDeviceSignalAccess } from '@/connections/android/useDeviceSignalAccess';
import { useAssistantAccess } from '@/connections/android/useAssistantAccess';
import { getAndroidNativeModulesHealth } from '@/connections/android/nativeModulesHealth';
import {
  MIN_TOUCH_TARGET,
  gutter,
  palette,
  radius,
  spacing,
} from '@/theme/tokens';

/**
 * Production Account UI for the on-device Android connector.
 *
 * Connect/disconnect here only; Android system permissions are never toggled
 * automatically — tapping a permission opens the relevant Android Settings
 * screen and the state re-reads live on return to foreground.
 *
 * Each permission is one tappable row rather than a card with a button stacked
 * underneath it. Three stacked buttons made the screen read as a form to fill
 * in, when it is really a status list where acting is the exception; the row
 * idiom is also what the Android settings screens these rows lead to use.
 */
export default function AndroidConnectScreen() {
  const { connection } = useConnection('android');
  const connect = useConnectConnector();
  const disconnect = useDisconnectConnection();
  const access = useAndroidDeviceAccess();
  const signals = useDeviceSignalAccess();
  const assistant = useAssistantAccess();
  const [missingModules] = useState(() =>
    getAndroidNativeModulesHealth().filter(
      (entry) => entry.available === false && entry.reason === 'MODULE_NOT_LINKED',
    ),
  );

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
  const deviceName = state?.device
    ? `${state.device.manufacturer} ${state.device.model}`
    : null;

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
          Read and control supported Android settings on this device.
        </Text>

        {/* One summary line. The device name and connection state were
            previously repeated across two cards. */}
        <View style={[styles.card, styles.summaryCard]}>
          <Text variant="cardTitle">{deviceName ?? 'Android device'}</Text>
          <Text variant="bodySmall" tone={connected ? 'brand' : 'muted'}>
            {connected ? 'Connected' : 'Not connected'}
          </Text>
        </View>

        {!state?.nativeAvailable ? (
          <Text variant="body" tone="danger">
            The native Android settings bridge is unavailable in this build.
            Rebuild the app with the native module included.
          </Text>
        ) : (
          <View style={styles.section}>
            <Text variant="headline">Device access</Text>

            <View style={styles.card}>
              <AccessRow
                title="Read system settings"
                description="Read supported device settings."
                allowed={state.readSettings}
              />
              <AccessRow
                title="Modify system settings"
                description="Change brightness, screen timeout and auto-rotate."
                allowed={state.writeSettings}
                onPress={() => void requestWriteSystemSettingsPermission()}
              />
              <AccessRow
                title="Display over other apps"
                description="Optional, for future on-screen Creepy controls."
                allowed={state.overlay}
                optional
                onPress={() => void requestOverlayPermission()}
                last
              />
            </View>

            {assistant.available ? (
              <View style={styles.card}>
                <AccessRow
                  title="Digital assistant"
                  description="Lets Creepy read your screen when you invoke it."
                  allowed={assistant.status?.isDefault}
                  optional
                  onPress={assistant.requestRole}
                  last
                />
              </View>
            ) : null}

            <Text variant="headline">Device signals</Text>
            {/*
              Separate from the rows above because these are granted on their
              own system screens rather than by a dialog, and neither reports
              back — the state below re-reads when the app returns.
            */}
            <View style={styles.card}>
              <AccessRow
                title="App usage history"
                description="Lets Creepy notice when you usually open things."
                allowed={signals.usageGranted}
                optional
                onPress={signals.openUsageSettings}
              />
              <AccessRow
                title="Read notifications"
                description="Summarise and reply to messages without opening the app."
                allowed={signals.notificationsGranted}
                optional
                onPress={signals.openNotificationSettings}
                last={!signals.notificationsGranted}
              />
              {/*
                Only shown once access exists: "granted but not yet bound" is a
                real transient state, and surfacing it before the grant would
                just be a second row saying no.
              */}
              {signals.notificationsGranted ? (
                <AccessRow
                  title="Listener running"
                  description="Android binds the listener a moment after you allow it."
                  allowed={signals.notificationsConnected}
                  optional
                  last
                />
              ) : null}
            </View>

            <Text variant="bodySmall" tone="muted">
              Changes apply when you return from the Android settings screen.
            </Text>

            {missingModules.length > 0 ? (
              <Text variant="bodySmall" tone="danger">
                Native modules missing from this build:{' '}
                {missingModules.map((entry) => entry.module).join(', ')}. The
                matching capabilities will not work until the app is rebuilt.
              </Text>
            ) : null}
          </View>
        )}

        {error ? (
          <Text variant="bodySmall" tone="danger" style={styles.error}>
            {error}
          </Text>
        ) : null}

        <View style={styles.section}>
          {connected ? (
            <>
              <Button
                label="Disconnect this device"
                variant="secondary"
                loading={disconnect.isPending}
                onPress={() => {
                  if (connection) void disconnect.mutateAsync(connection.id);
                }}
              />
              <Text variant="bodySmall" tone="muted">
                Disconnecting disables the connector but does not revoke Android
                permissions already granted in system settings.
              </Text>
            </>
          ) : (
            <Button
              label="Connect this device"
              loading={connect.isPending}
              onPress={() => void connect.mutateAsync('android')}
            />
          )}
          <Button label="Back" variant="ghost" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </Screen>
  );
}

/**
 * One permission.
 *
 * Rows that lead somewhere are pressable across their whole width and show a
 * chevron; the read permission is granted by the manifest and has nowhere to
 * go, so it is inert and carries no affordance. The status sits on the right
 * of the title, where a list is scanned, instead of under the description.
 */
function AccessRow({
  title,
  description,
  allowed,
  optional = false,
  onPress,
  last = false,
}: {
  title: string;
  description: string;
  allowed?: boolean;
  optional?: boolean;
  onPress?: () => void;
  last?: boolean;
}) {
  const status = allowed ? 'Allowed' : optional ? 'Optional' : 'Needed';

  const body = (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={styles.rowText}>
        <Text variant="label">{title}</Text>
        <Text variant="bodySmall" tone="secondary">
          {description}
        </Text>
      </View>
      <View style={styles.rowStatus}>
        <Text
          variant="tag"
          tone={allowed ? 'brand' : optional ? 'muted' : 'secondary'}
          uppercase
        >
          {status}
        </Text>
        {onPress ? (
          <Text variant="label" tone="faint" style={styles.chevron}>
            ›
          </Text>
        ) : null}
      </View>
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${status}. Opens Android settings.`}
      onPress={onPress}
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
    >
      {body}
    </Pressable>
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.md,
    // A hairline keeps three rows from reading as one paragraph, which is what
    // the stacked-button layout relied on the buttons to do.
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.borderSoft,
  },
  // The access card's padding is carried by its rows, so the card itself is
  // near-flush; a card of plain text needs its own.
  summaryCard: { paddingVertical: spacing.lg, gap: spacing.xs },
  rowLast: { borderBottomWidth: 0 },
  rowText: { flex: 1, gap: spacing.xs },
  rowStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chevron: { marginTop: -2 },
  pressed: { opacity: 0.6 },
  error: { textAlign: 'center' },
});
