import React, { useState } from "react";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";

import { OnboardingNavBar } from "@/components/OnboardingNavBar";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { ConnectorGrid } from "@/features/connectors/ConnectorGrid";
import { connectUnavailableMessage } from "@/features/connectors/connect";
import { gutter, spacing } from "@/theme/tokens";

export default function OnboardingConnections() {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);

  /*
   * Nothing can legitimately be connected yet: there is no OAuth flow to grant
   * a connection and no store to remember one. Rather than flip a label and
   * claim otherwise, a tap explains the state.
   */
  const connectedIds = new Set<string>();

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

        <ConnectorGrid
          connectedIds={connectedIds}
          onConnect={(entry) => setNotice(connectUnavailableMessage(entry))}
        />

        {notice ? (
          <Text
            accessibilityLiveRegion="polite"
            variant="bodySmall"
            tone="secondary"
            style={styles.notice}
          >
            {notice}
          </Text>
        ) : null}
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
  intro: { alignItems: "center", marginBottom: spacing.xxl },
  heading: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    textAlign: "center",
  },
  body: { textAlign: "center" },
  notice: { marginTop: spacing.xl, textAlign: "center" },
});
