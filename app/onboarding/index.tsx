import React, { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  Pressable,
  View,
} from "react-native";

import { requestEmailCode } from "@/auth/emailAuth";
import {
  canonicalName,
  isValidName,
  NAME_MIN_LENGTH,
} from "@/features/onboarding/name";
import { OnboardingNavBar } from "@/components/OnboardingNavBar";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import CreepyMascot from "@assets/icons/creepy-mascot.svg";
import { setPendingEmailAuth, setUserProfile } from "@/storage/prefs";
import { gutter, palette, radius, shadow, spacing } from "@/theme/tokens";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function OnboardingProfile() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedName = useMemo(() => canonicalName(name), [name]);
  const normalizedEmail = email.trim().toLowerCase();
  const nameIsValid = useMemo(() => isValidName(name), [name]);
  const emailIsValid = useMemo(
    () => EMAIL_PATTERN.test(normalizedEmail),
    [normalizedEmail],
  );
  const canContinue = nameIsValid && emailIsValid && !saving;

  /**
   * Why Continue is unavailable, in words.
   *
   * Both fields are required, but only the email announced itself — a missing
   * or one-character name left the button inert with nothing on screen to
   * explain it, which reads as "the app is broken" rather than "finish the
   * form". Stated as guidance rather than an error, since not-yet-filled is
   * the normal starting state.
   */
  const blockedReason = saving
    ? null
    : !nameIsValid
      ? 'Enter your name to continue.'
      : !emailIsValid
        ? 'Enter a valid email address to continue.'
        : null;

  const advance = useCallback(async () => {
    if (!canContinue) return;

    setSaving(true);
    setError(null);
    try {
      const challenge = await requestEmailCode({
        email: normalizedEmail,
        name: normalizedName,
        purpose: "registration",
      });

      /*
       * Some accounts are signed in by the request itself and never receive a
       * code; the session is already stored by then. Sending such a user to a
       * screen asking for a code they will never get is the whole failure this
       * avoids. The app does not know which accounts these are — it only knows
       * the server said this one is done.
       */
      if (challenge.autoVerified) {
        await setUserProfile({ name: normalizedName, email: normalizedEmail });
        await queryClient.invalidateQueries({ queryKey: ["auth-session"] });
        router.replace("/onboarding/features");
        return;
      }

      await Promise.all([
        setUserProfile({
          name: normalizedName,
          email: normalizedEmail,
        }),
        setPendingEmailAuth({
          challengeId: challenge.challengeId,
          email: normalizedEmail,
          name: normalizedName,
          purpose: "registration",
        }),
      ]);
      router.push("/onboarding/auth");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not send the verification code.",
      );
    } finally {
      setSaving(false);
    }
  }, [canContinue, normalizedEmail, normalizedName, queryClient, router]);

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
            <View style={styles.mascotFrame}>
              <CreepyMascot width={64} height={64} color={palette.brand} />
            </View>
            <Text variant="display" style={styles.heading}>
              Let&apos;s get acquainted
            </Text>
            <Text variant="bodyLarge" tone="secondary" style={styles.body}>
              Tell us how to address you and where to send account updates.
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text variant="label">Your name</Text>
              <TextInput
                accessibilityLabel="Your name"
                autoCapitalize="words"
                autoComplete="name"
                maxLength={80}
                onChangeText={setName}
                placeholder="Enter your name"
                placeholderTextColor={palette.textFaint}
                returnKeyType="next"
                style={styles.input}
                value={name}
              />
              {name.length > 0 && !nameIsValid ? (
                <Text variant="bodySmall" tone="danger">
                  Enter at least {NAME_MIN_LENGTH} characters.
                </Text>
              ) : null}
            </View>

            <View style={styles.field}>
              <Text variant="label">Email</Text>
              <TextInput
                accessibilityLabel="Email"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                keyboardType="email-address"
                maxLength={254}
                onChangeText={setEmail}
                onSubmitEditing={() => void advance()}
                placeholder="name@example.com"
                placeholderTextColor={palette.textFaint}
                returnKeyType="done"
                style={styles.input}
                value={email}
              />
              {email.length > 0 && !emailIsValid ? (
                <Text variant="bodySmall" tone="danger">
                  Enter a valid email address.
                </Text>
              ) : null}
            </View>
            {error ? (
              <Text
                accessibilityLiveRegion="polite"
                variant="bodySmall"
                tone="danger"
              >
                {error}
              </Text>
            ) : blockedReason ? (
              <Text
                accessibilityLiveRegion="polite"
                variant="bodySmall"
                tone="secondary"
              >
                {blockedReason}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/auth")}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text variant="label" tone="brand" style={styles.signIn}>
                Already have an account? Sign in
              </Text>
            </Pressable>
          </View>
        </ScrollView>

        <OnboardingNavBar
          onAdvance={() => void advance()}
          advanceLabel={saving ? "Saving" : "Continue"}
          advanceDisabled={!canContinue}
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
  mascotFrame: {
    width: 96,
    height: 96,
    marginBottom: spacing.xxl,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.borderFaint,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    ...shadow.card,
  },
  heading: { marginBottom: spacing.lg, textAlign: "center" },
  body: { textAlign: "center" },
  form: { gap: spacing.xl },
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
  signIn: { textAlign: "center" },
  pressed: { opacity: 0.7 },
});
