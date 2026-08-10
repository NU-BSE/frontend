import React from "react";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { OnboardingNavBar } from "@/components/OnboardingNavBar";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { ConnectorList } from "@/features/connections/ConnectorList";
import { gutter, spacing } from "@/theme/tokens";

export default function OnboardingConnections() {
  const router = useRouter();

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <Text variant="tag" tone="brand" uppercase>Optional</Text>
          <Text variant="display" style={styles.heading}>Connect your services</Text>
          <Text variant="bodyLarge" tone="secondary" style={styles.body}>
            Connect the services you want Creepy to work with. You can skip this step and add them later.
          </Text>
        </View>
        <ConnectorList />
      </ScrollView>
      <OnboardingNavBar onBack={() => router.back()} onAdvance={() => router.push("/onboarding/memory")} advanceLabel="Continue" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: "center", paddingHorizontal: gutter.screen, paddingVertical: spacing.xxxl },
  intro: { alignItems: "center", marginBottom: spacing.xxxl },
  heading: { marginTop: spacing.sm, marginBottom: spacing.lg, textAlign: "center" },
  body: { textAlign: "center" },
});
