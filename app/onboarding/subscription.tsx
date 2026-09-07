import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { track } from "@/analytics";
import { OnboardingNavBar } from "@/components/OnboardingNavBar";
import { OnboardingProgress, progressFor } from "@/components/OnboardingProgress";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import {
  BillingUnavailable,
  PurchaseCancelled,
  fetchStorePrices,
  purchase,
  type StorePrice,
} from "@/features/subscription/billing";
import {
  SUBSCRIPTION_PLANS,
  TRIAL_DAYS,
  planFor,
  type BillingPeriod,
} from "@/features/subscription/plans";
import { resolvePricing } from "@/features/subscription/pricing";
import { shouldShowPaywall } from "@/features/onboarding/subscriptionDecision";
import { getMySubscription, verifyPlayPurchase } from "@/api/client";
import { getMemoryProfile, setOnboardingComplete } from "@/storage/prefs";
import { gutter, palette, radius, spacing } from "@/theme/tokens";

/**
 * The paywall, shown only after the first real Creepy task and the feedback
 * that follows it — never before. Skipping is deliberately available and
 * plainly worded, and its copy is honest about what actually runs on this
 * phone: it says "keep using Creepy on this phone" only when the on-device
 * engine was really chosen and is really available, and otherwise says Cloud.
 */
export default function OnboardingSubscription() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [period, setPeriod] = useState<BillingPeriod>("annual");
  const [storePrices, setStorePrices] = useState<
    Partial<Record<BillingPeriod, StorePrice>>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: memoryProfile } = useQuery({
    queryKey: ["memory-profile"],
    queryFn: getMemoryProfile,
    staleTime: Infinity,
  });
  const onDevice = memoryProfile !== "cloud";

  const paywallViewed = useRef(false);
  useEffect(() => {
    if (paywallViewed.current) return;
    paywallViewed.current = true;
    track("onboarding_paywall_viewed");
  }, []);

  /*
   * Some accounts are not billed at all — today that means the credentials
   * handed to store reviewers, but the app has no idea which accounts those
   * are and no way to find out. It asks the server whether *this* caller needs
   * to pay and believes the answer. Nothing identifying an exempt account is
   * in the bundle, so shipping the app does not ship the list.
   */
  const { data: exempt, isPending: checkingExemption } = useQuery({
    queryKey: ["subscription-required"],
    queryFn: async () => {
      const { entitlements } = await getMySubscription();
      return !shouldShowPaywall(entitlements.subscriptionRequired);
    },
    // The paywall is the safe outcome, so a failure to ask is not retried into
    // a long spinner — one attempt, then show the offer.
    retry: false,
    staleTime: Infinity,
  });

  /*
   * Play's prices are localized and authoritative; the plan table only carries
   * the marketing figures. Fetching is best-effort — an unreachable store
   * leaves the fallback prices on screen rather than an empty paywall.
   */
  useEffect(() => {
    let cancelled = false;
    void fetchStorePrices().then((prices) => {
      if (!cancelled) setStorePrices(prices);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const complete = useCallback(async () => {
    await setOnboardingComplete();
    await queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
    track("onboarding_completed");
    router.replace("/(tabs)/feed");
  }, [queryClient, router]);

  const startTrial = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await purchase(period);
      track(
        period === "annual"
          ? "onboarding_trial_started"
          : "onboarding_subscription_started",
        { period },
      );
      /*
       * Still no local "subscribed" flag. The purchase token proves payment to
       * Play, not entitlement to this app: the backend resolves it against the
       * Play Developer API and is the only thing that can grant anything.
       *
       * A failure here is the one case where the user has paid and holds
       * nothing, so it must not be silent. Onboarding still finishes — Play
       * has the money and the subscription is real — but the message says the
       * activation is pending rather than pretending it worked. RTDN will
       * deliver the same purchase again, so this recovers on its own.
       */
      try {
        await verifyPlayPurchase({
          purchaseToken: result.purchaseToken,
          productId: result.productId,
          basePlanId: result.basePlanId,
        });
      } catch (verifyError) {
        setError(
          verifyError instanceof Error
            ? `Payment succeeded, but activation is still pending: ${verifyError.message}`
            : "Payment succeeded, but activation is still pending.",
        );
      }
      await complete();
    } catch (purchaseError) {
      if (purchaseError instanceof PurchaseCancelled) {
        setError(null);
      } else if (purchaseError instanceof BillingUnavailable) {
        setError(purchaseError.message);
      } else {
        setError(
          purchaseError instanceof Error
            ? purchaseError.message
            : "The purchase could not be completed.",
        );
      }
    } finally {
      setBusy(false);
    }
  }, [busy, complete, period]);

  /*
   * Skip once, and only forwards. `complete()` navigates, so without the guard
   * a re-render between the decision and the transition would fire it twice.
   */
  const skipped = useRef(false);
  useEffect(() => {
    if (exempt && !skipped.current) {
      skipped.current = true;
      void complete();
    }
  }, [complete, exempt]);

  if (checkingExemption || exempt) {
    // Held rather than showing the paywall for a beat and snatching it away.
    return (
      <Screen>
        <View style={styles.checking}>
          <ActivityIndicator color={palette.brand} />
        </View>
      </Screen>
    );
  }

  const selected = planFor(period);
  /*
   * Every figure on this screen comes from one source. Mixing Play's localized
   * price with the USD list prices put "HK$99.00" above "Billed $12.90 today"
   * and advertised a saving in a currency the user is never charged in.
   */
  const pricing = resolvePricing(storePrices);
  const price = pricing.price;

  return (
    <Screen>
      <View style={styles.progressWrap}>
        <OnboardingProgress fraction={progressFor("subscription")} />
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <Text variant="tag" tone="brand" uppercase>
            Creepy Pro
          </Text>
          <Text variant="display" style={styles.heading}>
            Keep Creepy working for you
          </Text>
          <Text variant="bodyLarge" tone="secondary" style={styles.body}>
            Full access to Creepy, connected apps and local AI.
          </Text>
        </View>

        <View style={styles.toggle}>
          {SUBSCRIPTION_PLANS.map((plan) => {
            const active = plan.period === period;
            return (
              <Pressable
                key={plan.period}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${plan.label}, ${price(plan.period)}`}
                disabled={busy}
                onPress={() => setPeriod(plan.period)}
                style={({ pressed }) => [
                  styles.toggleOption,
                  active && styles.toggleOptionActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text variant="label" tone={active ? "inverse" : "primary"}>
                  {plan.label}
                </Text>
                {pricing.badge(plan.period) ? (
                  <Text
                    variant="bodySmall"
                    tone={active ? "inverse" : "brand"}
                  >
                    {pricing.badge(plan.period)}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.card}>
          {/*
            * The trial is an offer on the annual base plan only, so only the
            * annual card may mention one. Promising a trial the store will not
            * honour is the kind of thing a user discovers at the moment they
            * are charged.
            */}
          <Text variant="headline">
            {selected.hasFreeTrial
              ? `${TRIAL_DAYS} days free, then one simple price`
              : 'One simple price'}
          </Text>

          <View style={styles.priceRow}>
            <Text variant="display">{price(period)}</Text>
            <Text variant="bodySmall" tone="secondary">
              {selected.caption}
            </Text>
          </View>

          {period === "annual" ? (
            <Text variant="bodySmall" tone="brand">
              {price("annual")} / year · {pricing.perMonth} per month
            </Text>
          ) : null}

          <Text variant="bodySmall" tone="secondary">
            {pricing.terms(period)}
          </Text>
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
          accessibilityLabel="Not now, continue without Pro"
          disabled={busy}
          onPress={() => void complete()}
          style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
        >
          <Text variant="label" tone="secondary">
            {onDevice
              ? "Not now — keep using Creepy on this phone"
              : "Not now — continue with Cloud"}
          </Text>
        </Pressable>
      </ScrollView>

      <OnboardingNavBar
        onBack={() => router.back()}
        onAdvance={() => void startTrial()}
        advanceLabel={busy ? "Opening Play" : selected.cta}
        advanceDisabled={busy}
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
  progressWrap: {
    paddingHorizontal: gutter.screen,
    paddingTop: spacing.lg,
  },
  intro: { alignItems: "center", marginBottom: spacing.xxl },
  heading: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    textAlign: "center",
  },
  body: { textAlign: "center" },
  toggle: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: palette.neutralWash,
    marginBottom: spacing.xl,
  },
  toggleOption: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  toggleOptionActive: { backgroundColor: palette.brand },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
  },
  priceRow: { gap: spacing.xs },
  message: { marginTop: spacing.lg, textAlign: "center" },
  skip: { alignSelf: "center", marginTop: spacing.xl, padding: spacing.md },
  pressed: { opacity: 0.75 },
  checking: { flex: 1, alignItems: "center", justifyContent: "center" },
});
