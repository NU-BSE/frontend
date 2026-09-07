import React, { useCallback, useEffect, useState } from "react";
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

import { requestEmailCode, verifyEmailCode } from "./emailAuth";
import { track } from "@/analytics";
import { OnboardingNavBar } from "@/components/OnboardingNavBar";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import {
  clearPendingEmailAuth,
  getPendingEmailAuth,
  setOnboardingComplete,
  setPendingEmailAuth,
  type PendingEmailAuth,
} from "@/storage/prefs";
import { gutter, palette, radius, spacing } from "@/theme/tokens";

export function EmailCodeScreen({ mode }: { mode: "registration" | "login" }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingEmailAuth | null>(null);
  const [loadingPending, setLoadingPending] = useState(true);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getPendingEmailAuth().then((value) => {
      setPending(value?.purpose === mode ? value : null);
      setLoadingPending(false);
    });
  }, [mode]);

  const normalizedCode = code.replace(/\D/gu, "").slice(0, 6);
  const canSubmit =
    normalizedCode.length === 6 && Boolean(pending) && !submitting;

  const verify = useCallback(async () => {
    if (!pending || !canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      const session = await verifyEmailCode({
        challengeId: pending.challengeId,
        code: normalizedCode,
        email: pending.email,
      });
      await clearPendingEmailAuth();
      await queryClient.invalidateQueries({ queryKey: ["auth-session"] });

      if (mode === "registration") {
        track("onboarding_auth_completed");
        router.replace("/onboarding/features");
        return;
      }

      if (session.onboardingCompleted === false) {
        router.replace("/onboarding/features");
      } else {
        await setOnboardingComplete();
        await queryClient.invalidateQueries({
          queryKey: ["onboarding-status"],
        });
        router.replace("/(tabs)/feed");
      }
    } catch (verifyError) {
      setError(
        verifyError instanceof Error
          ? verifyError.message
          : "The verification code could not be checked.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, mode, normalizedCode, pending, queryClient, router]);

  const resend = useCallback(async () => {
    if (!pending || resending) return;

    setResending(true);
    setError(null);
    try {
      const challenge = await requestEmailCode({
        email: pending.email,
        name: pending.name,
        purpose: pending.purpose,
      });
      const nextPending = {
        ...pending,
        challengeId: challenge.challengeId,
      };
      await setPendingEmailAuth(nextPending);
      setPending(nextPending);
      setCode("");
    } catch (resendError) {
      setError(
        resendError instanceof Error
          ? resendError.message
          : "Could not send a new code.",
      );
    } finally {
      setResending(false);
    }
  }, [pending, resending]);

  const goBack = useCallback(() => {
    if (mode === "registration") {
      router.back();
    } else {
      router.replace("/auth");
    }
  }, [mode, router]);

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
              Check your email
            </Text>
            <Text variant="bodyLarge" tone="secondary" style={styles.body}>
              {pending
                ? `Enter the 6-digit code sent to ${pending.email}.`
                : loadingPending
                  ? "Loading your verification request…"
                  : "Request a new code to continue."}
            </Text>
          </View>

          <TextInput
            accessibilityLabel="Six digit verification code"
            autoComplete="one-time-code"
            autoFocus
            editable={Boolean(pending) && !submitting}
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={(value) =>
              setCode(value.replace(/\D/gu, "").slice(0, 6))
            }
            onSubmitEditing={() => void verify()}
            placeholder="000000"
            placeholderTextColor={palette.textFaint}
            returnKeyType="done"
            style={styles.codeInput}
            textContentType="oneTimeCode"
            value={normalizedCode}
          />

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
            disabled={!pending || resending}
            onPress={() => void resend()}
            style={({ pressed }) => [
              styles.resend,
              pressed && styles.pressed,
              (!pending || resending) && styles.disabled,
            ]}
          >
            <Text variant="label" tone="brand">
              {resending ? "Sending…" : "Send a new code"}
            </Text>
          </Pressable>
        </ScrollView>

        <OnboardingNavBar
          onBack={goBack}
          onAdvance={() => void verify()}
          advanceLabel={submitting ? "Checking" : "Verify"}
          advanceDisabled={!canSubmit}
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
  codeInput: {
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    color: palette.textPrimary,
    fontSize: 28,
    letterSpacing: 12,
    textAlign: "center",
  },
  message: { marginTop: spacing.md, textAlign: "center" },
  resend: {
    alignSelf: "center",
    marginTop: spacing.xl,
    padding: spacing.md,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
