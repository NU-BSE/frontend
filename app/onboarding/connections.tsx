import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";

import { AUTH_PROVIDERS } from "@/auth/providers";
import { Button } from "@/components/Button";
import { OnboardingNavBar } from "@/components/OnboardingNavBar";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { gutter, palette, radius, shadow, spacing } from "@/theme/tokens";
import { listConnectors, connectConnector, disconnectConnector } from "@/api/client";

export default function OnboardingConnections() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: connectors } = useQuery({
    queryKey: ["connectors"],
    queryFn: listConnectors,
  });

  const connectMut = useMutation({
    mutationFn: connectConnector,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["connectors"] }),
  });

  const disconnectMut = useMutation({
    mutationFn: disconnectConnector,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["connectors"] }),
  });

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
            Connect your services
          </Text>
          <Text variant="bodyLarge" tone="secondary" style={styles.body}>
            Connect the services you want Creepy to work with. You can skip this
            step and add them later.
          </Text>
        </View>

        <View style={styles.card}>
          {AUTH_PROVIDERS.map((provider) => {
            const connector = connectors?.find((c) => c.id === provider.connectorId);
            const connected = connector?.connected ?? false;
            return (
              <View key={provider.id} style={styles.provider}>
                <Button
                  label={
                    connected
                      ? `${provider.label} — Connected`
                      : provider.label
                  }
                  variant={connected ? "primary" : "secondary"}
                  disabled={!provider.enabled}
                  loading={connectMut.isPending || disconnectMut.isPending}
                  onPress={() => {
                    if (!provider.connectorId) return;
                    if (connected) {
                      disconnectMut.mutate(provider.connectorId);
                    } else {
                      connectMut.mutate(provider.connectorId);
                    }
                  }}
                />
                {!provider.enabled && provider.note ? (
                  <Text variant="bodySmall" tone="muted" style={styles.note}>
                    {provider.note}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <OnboardingNavBar
        onBack={() => router.back()}
        onAdvance={() => router.push("/onboarding/memory")}
        advanceLabel="Continue"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: gutter.screen,
    paddingVertical: spacing.xxxl,
  },
  intro: { alignItems: "center", marginBottom: spacing.xxxl },
  heading: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    textAlign: "center",
  },
  body: { textAlign: "center" },
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
