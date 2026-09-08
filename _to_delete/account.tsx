import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useAi } from '@/ai/AiProvider';
import { AUTH_PROVIDERS } from '@/auth/providers';
import { resetOnboarding } from '@/storage/prefs';
import { palette, radius, spacing } from '@/theme/tokens';

export default function Account() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { origin, status, degradedReason } = useAi();

  const replay = useMutation({
    mutationFn: resetOnboarding,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
      router.replace('/onboarding');
    },
  });

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Text variant="title">Account</Text>
        <Text variant="micro" tone="muted">
          Anonymous — nothing is linked yet
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
      >
        <View style={styles.section}>
          <Text variant="heading">Sign in</Text>
          <Text variant="caption" tone="muted">
            Linking an account will sync history across devices. Until a
            provider is wired up, everything stays on this phone.
          </Text>

          <View style={styles.providers}>
            {AUTH_PROVIDERS.map((provider) => (
              <View key={provider.id} style={styles.providerRow}>
                <Button
                  label={provider.label}
                  variant="secondary"
                  disabled={!provider.enabled}
                  onPress={() => {
                    // Intentionally inert: see src/auth/providers.ts.
                  }}
                />
                {!provider.enabled && provider.note ? (
                  <Text variant="micro" tone="muted" style={styles.note}>
                    {provider.note}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text variant="heading">Model</Text>
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Text variant="caption" tone="muted">
                Location
              </Text>
              <Text variant="caption" tone={origin === 'on-device' ? 'accent' : 'secondary'}>
                {origin}
              </Text>
            </View>
            <View style={styles.cardRow}>
              <Text variant="caption" tone="muted">
                Status
              </Text>
              <Text
                variant="caption"
                tone={status === 'degraded' ? 'danger' : 'secondary'}
              >
                {status}
              </Text>
            </View>
            {degradedReason ? (
              <Text variant="micro" tone="danger">
                {degradedReason}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text variant="heading">Developer</Text>
          <Button
            label="Replay onboarding"
            variant="ghost"
            loading={replay.isPending}
            onPress={() => replay.mutate()}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.hairline,
  },
  content: { padding: spacing.lg, gap: spacing.xxl },
  section: { gap: spacing.md },
  providers: { gap: spacing.md },
  providerRow: { gap: spacing.xs },
  note: { paddingHorizontal: spacing.xs },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairline,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
