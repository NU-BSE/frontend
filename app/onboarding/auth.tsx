import React from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AUTH_PROVIDERS } from '@/auth/providers';
import { Button } from '@/components/Button';
import { OnboardingNavBar } from '@/components/OnboardingNavBar';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { gutter, palette, radius, shadow, spacing } from '@/theme/tokens';

export default function OnboardingAuth() {
  const router = useRouter();

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <Text variant="tag" tone="brand" uppercase>
            Optional
          </Text>
          <Text variant="display" style={styles.heading}>
            Connect your accounts
          </Text>
          <Text variant="bodyLarge" tone="secondary" style={styles.body}>
            Additional authorization will enable cross-device sync and connected
            services. You can skip this step and connect later.
          </Text>
        </View>

        <View style={styles.card}>
          {AUTH_PROVIDERS.map((provider) => (
            <View key={provider.id} style={styles.provider}>
              <Button
                label={provider.label}
                variant="secondary"
                disabled={!provider.enabled}
                onPress={() => {
                  // Provider implementations will attach here.
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
      </ScrollView>

      <OnboardingNavBar
        onBack={() => router.back()}
        onAdvance={() => router.push('/onboarding/memory')}
        advanceLabel="Continue"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: gutter.screen,
    paddingVertical: spacing.xxxl,
  },
  intro: { alignItems: 'center', marginBottom: spacing.xxxl },
  heading: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  body: { textAlign: 'center' },
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
