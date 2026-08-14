import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useConnectConnector } from '@/connections/useConnections';
import { describeGoogleAuthError } from '@/connections/google/errors';
import {
  GOOGLE_SCOPE_DESCRIPTIONS,
  missingFunctionalScopes,
} from '@/connections/google/scopeCopy';
import { gutter, palette, radius, spacing } from '@/theme/tokens';

type Phase =
  | { step: 'review' }
  | { step: 'authorizing' }
  | { step: 'failed'; message: string; detail?: string }
  | { step: 'connected'; account: string; missing: string[] };

/**
 * Google consent, ahead of Google's own consent.
 *
 * Tapping the Google cell used to call `connect.mutate('google')` inline, which
 * launched the account picker with no warning and reported failure as one line
 * of red text under a grid. This screen exists so the user reads what is being
 * requested before Google asks, and so a refusal or a native error is
 * explained rather than abbreviated.
 *
 * The screen never touches the bridge directly. It runs the connector's own
 * `connect()` through the same mutation as every other connector, so the
 * credential lands in the vault and the ConnectionStore is the single source
 * of truth — this is a presentation layer over the existing flow, not a second
 * way to authorize.
 */
export default function GoogleConnectScreen() {
  const [phase, setPhase] = useState<Phase>({ step: 'review' });
  const connect = useConnectConnector();
  const mountedRef = useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const authorize = useCallback(async () => {
    setPhase({ step: 'authorizing' });
    try {
      const record = await connect.mutateAsync('google');
      if (!mountedRef.current) return;
      setPhase({
        step: 'connected',
        account: record.displayName ?? 'Google',
        missing: missingFunctionalScopes(record.scopes ?? []),
      });
    } catch (error) {
      if (!mountedRef.current) return;
      const failure = describeGoogleAuthError(error);
      // A cancel returns to the review step rather than showing an error: the
      // user closing Google's sheet is a decision, not a fault.
      setPhase(
        failure.kind === 'cancelled'
          ? { step: 'review' }
          : {
              step: 'failed',
              message: failure.message,
              ...(failure.detail ? { detail: failure.detail } : {}),
            },
      );
    }
  }, [connect]);

  if (phase.step === 'connected') {
    return (
      <Screen>
        <View style={styles.centered}>
          <Text variant="headline" style={styles.centerText}>
            Google connected
          </Text>
          <Text variant="body" tone="secondary" style={styles.centerText}>
            {phase.account}
          </Text>

          {phase.missing.length > 0 ? (
            <View style={styles.warning}>
              <Text variant="bodySmall" tone="danger" style={styles.centerText}>
                {phase.missing.join(' and ')}{' '}
                {phase.missing.length === 1 ? 'access was' : 'access were'} not
                granted, so those tools will find nothing. Reconnect and accept
                {phase.missing.length === 1 ? ' it' : ' them'} to enable them.
              </Text>
            </View>
          ) : null}

          <Button label="Done" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="display" style={styles.centerText}>
          Connect Google
        </Text>
        <Text variant="bodyLarge" tone="secondary" style={styles.centerText}>
          Creepy will ask Google for read-only access. Tokens are kept on this
          device and never sent to our servers.
        </Text>

        <View style={styles.scopes}>
          {GOOGLE_SCOPE_DESCRIPTIONS.map((entry) => (
            <View key={entry.scope} style={styles.scopeRow}>
              <Text variant="label">{entry.title}</Text>
              <Text variant="bodySmall" tone="secondary">
                {entry.detail}
              </Text>
            </View>
          ))}
        </View>

        <Text variant="bodySmall" tone="secondary" style={styles.centerText}>
          Read-only means read-only: no scope requested here can send mail,
          change an event, or alter a file.
        </Text>

        {phase.step === 'failed' ? (
          <View accessibilityLiveRegion="polite" style={styles.failure}>
            <Text variant="body" tone="danger" style={styles.centerText}>
              {phase.message}
            </Text>
            {phase.detail ? (
              <Text variant="bodySmall" tone="faint" style={styles.centerText}>
                {phase.detail}
              </Text>
            ) : null}
          </View>
        ) : null}

        {phase.step === 'authorizing' ? (
          <View style={styles.busy}>
            <ActivityIndicator color={palette.brand} />
            <Text variant="bodySmall" tone="secondary">
              Waiting for Google…
            </Text>
          </View>
        ) : (
          <Button
            label={phase.step === 'failed' ? 'Try again' : 'Continue with Google'}
            onPress={() => void authorize()}
          />
        )}

        <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: gutter.screen,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: gutter.screen,
    gap: spacing.lg,
  },
  centerText: { textAlign: 'center' },
  scopes: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
  },
  scopeRow: { gap: spacing.xs },
  failure: { gap: spacing.xs },
  warning: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
  },
  busy: { alignItems: 'center', gap: spacing.sm },
});
