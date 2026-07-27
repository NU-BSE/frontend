import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TopAppBar } from '@/components/TopAppBar';
import { useAi } from '@/ai/AiProvider';
import { AUTH_PROVIDERS } from '@/auth/providers';
import { getMemoryProfile, resetOnboarding } from '@/storage/prefs';
import { gutter, palette, radius, shadow, spacing } from '@/theme/tokens';

export default function Auth() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { origin, status, degradedReason, deactivateEngine } = useAi();

  const { data: memoryProfile } = useQuery({
    queryKey: ['memory-profile'],
    queryFn: getMemoryProfile,
  });

  const replay = useMutation({
    mutationFn: resetOnboarding,
    onSuccess: async () => {
      await deactivateEngine();
      await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
      router.replace('/onboarding');
    },
  });

  return (
    <Screen>
      <TopAppBar />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + spacing.xxxl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text variant="headline">Sign in</Text>
          <Text variant="bodySmall" tone="secondary">
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
                    // Intentionally inert — see src/auth/providers.ts.
                  }}
                />
                {!provider.enabled && provider.note ? (
                  <Text variant="bodySmall" tone="muted" style={styles.note}>
                    {provider.note}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text variant="headline">Intelligence</Text>
          <View style={styles.card}>
            <Row label="Runs" value={origin} highlight={origin === 'on-device'} />
            <Row label="Status" value={status} danger={status === 'degraded'} />
            <Row label="Memory profile" value={memoryProfile ?? '—'} />
            {degradedReason ? (
              <Text variant="bodySmall" tone="danger">
                {degradedReason}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text variant="headline">Developer</Text>
          <Button
            label="Replay onboarding"
            variant="secondary"
            loading={replay.isPending}
            onPress={() => replay.mutate()}
          />
        </View>
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
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: gutter.screen,
    paddingTop: spacing.xl,
    gap: spacing.xxl,
  },
  section: { gap: spacing.md },
  providers: { gap: spacing.md, marginTop: spacing.xs },
  providerRow: { gap: spacing.xs },
  note: { paddingHorizontal: spacing.xs },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.card,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
