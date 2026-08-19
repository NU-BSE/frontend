import React, { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { requestEmailCode } from "@/auth/emailAuth";
import { OnboardingNavBar } from "@/components/OnboardingNavBar";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { setPendingEmailAuth } from "@/storage/prefs";
import { gutter, palette, radius, spacing } from "@/theme/tokens";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailSignIn() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedEmail = email.trim().toLowerCase();
  const emailIsValid = useMemo(
    () => EMAIL_PATTERN.test(normalizedEmail),
    [normalizedEmail],
  );

  const advance = useCallback(async () => {
    if (!emailIsValid || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const challenge = await requestEmailCode({
        email: normalizedEmail,
        purpose: "login",
      });

      // As on the sign-up screen: an account the server signed in directly has
      // no code to enter. In practice this screen sends no name, and the name
      // is half the demo credential, so it will not normally happen here — the
      // check is kept so the two entry points cannot drift.
      if (challenge.autoVerified) {
        await queryClient.invalidateQueries({ queryKey: ["auth-session"] });
        router.replace("/(tabs)/feed");
        return;
      }

      await setPendingEmailAuth({
        challengeId: challenge.challengeId,
        email: normalizedEmail,
        purpose: "login",
      });
      router.push("/auth/verify");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not send the sign-in code.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [emailIsValid, normalizedEmail, queryClient, router, submitting]);

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.intro}>
            <Text variant="display" style={styles.heading}>
              Sign in with email
            </Text>
            <Text variant="bodyLarge" tone="secondary" style={styles.body}>
              We&apos;ll send you a one-time code. No password is required.
            </Text>
          </View>

          <View style={styles.field}>
            <Text variant="label">Email</Text>
            <TextInput
              accessibilityLabel="Email"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              onChangeText={setEmail}
              onSubmitEditing={() => void advance()}
              placeholder="name@example.com"
              placeholderTextColor={palette.textFaint}
              returnKeyType="done"
              style={styles.input}
              value={email}
            />
          </View>

          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              variant="bodySmall"
              tone="danger"
              style={styles.message}
            >
              {error}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace("/onboarding")}
            style={({ pressed }) => [
              styles.createAccount,
              pressed && styles.pressed,
            ]}
          >
            <Text variant="label" tone="brand">
              New here? Create an account
            </Text>
          </Pressable>
        </ScrollView>

        <OnboardingNavBar
          onAdvance={() => void advance()}
          advanceLabel={submitting ? "Sending" : "Send code"}
          advanceDisabled={!emailIsValid || submitting}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: gutter.screen,
    paddingVertical: spacing.xxxl,
  },
  intro: { alignItems: "center", marginBottom: spacing.xxxl },
  heading: { marginBottom: spacing.lg, textAlign: "center" },
  body: { textAlign: "center" },
  field: { gap: spacing.sm },
  input: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    color: palette.textPrimary,
    fontSize: 16,
  },
  message: { marginTop: spacing.md, textAlign: "center" },
  createAccount: {
    alignSelf: "center",
    marginTop: spacing.xl,
    padding: spacing.md,
  },
  pressed: { opacity: 0.7 },
});
