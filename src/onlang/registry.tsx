import React, { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { OnlangRegistry, type ComponentProps } from '@onlang/react-native';

import { getInstalledModel, verifyInstalled } from '@/ai/modelInstall';
import { Text } from '@/components/Text';
import { planFor, type BillingPeriod } from '@/features/subscription/plans';
import { resolvePricing } from '@/features/subscription/pricing';
import { getMemoryProfile } from '@/storage/prefs';
import { MIN_TOUCH_TARGET, gutter, palette, radius, shadow, spacing } from '@/theme/tokens';

import { paywallState, usePaywallState } from './paywallState';

/**
 * Creepy's paywall components, registered under the names in `onlang/registry.json`.
 *
 * They are the classic paywall's pieces (`app/onboarding/subscription.tsx`), split so Onlang can
 * arrange and word them. Prices, plan facts and the skip copy stay computed here: the server
 * supplies only the marketing copy, and a hypothesis can't make the screen claim something about
 * billing or about this phone that isn't true.
 */

const isPeriod = (p: unknown): p is BillingPeriod => p === 'annual' || p === 'monthly';

function PaywallIntro({ props }: ComponentProps<{ tag: string; headline: string; body: string }>) {
  return (
    <View style={styles.intro}>
      <Text variant="tag" tone="brand" uppercase>
        {props.tag}
      </Text>
      <Text variant="display" style={styles.heading}>
        {props.headline}
      </Text>
      <Text variant="bodyLarge" tone="secondary" style={styles.center}>
        {props.body}
      </Text>
    </View>
  );
}

/** Reports its selections to Onlang (`onlang://select`) and to the other components. */
function PlanToggle({ props, context }: ComponentProps<{ products: string[]; default: string }>) {
  const { period, busy, prices } = usePaywallState();
  const pricing = resolvePricing(prices);
  useEffect(() => {
    // A new paywall starts on the composition's default plan.
    paywallState.reset(isPeriod(props.default) ? props.default : 'annual');
  }, [props.default]);
  const plans = props.products.filter(isPeriod).map(planFor);
  return (
    <View style={styles.toggle}>
      {plans.map((plan) => {
        const active = plan.period === period;
        const badge = pricing.badge(plan.period);
        return (
          <Pressable
            key={plan.period}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${plan.label}, ${pricing.price(plan.period)}`}
            disabled={busy}
            onPress={() => {
              if (plan.period === paywallState.get().period) return;
              paywallState.set({ period: plan.period, error: null });
              context.fire(`onlang://select?product=${plan.period}`);
            }}
            style={({ pressed }) => [styles.toggleOption, active && styles.toggleOptionActive, pressed && styles.pressed]}
          >
            <Text variant="label" tone={active ? 'inverse' : 'primary'}>
              {plan.label}
            </Text>
            {badge ? (
              <Text variant="bodySmall" tone={active ? 'inverse' : 'brand'}>
                {badge}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function PriceCard({ props }: ComponentProps<{ trial_headline: string; paid_headline: string }>) {
  const { period, prices } = usePaywallState();
  const pricing = resolvePricing(prices);
  const selected = planFor(period);
  return (
    <View style={styles.card}>
      {/* The trial is an offer on the annual base plan only, so only that card may mention one. */}
      <Text variant="headline">{selected.hasFreeTrial ? props.trial_headline : props.paid_headline}</Text>
      <View style={styles.priceRow}>
        <Text variant="display">{pricing.price(period)}</Text>
        <Text variant="bodySmall" tone="secondary">
          {selected.caption}
        </Text>
      </View>
      {period === 'annual' ? (
        <Text variant="bodySmall" tone="brand">
          {pricing.price('annual')} / year · {pricing.perMonth} per month
        </Text>
      ) : null}
      <Text variant="bodySmall" tone="secondary">
        {pricing.terms(period)}
      </Text>
    </View>
  );
}

/**
 * Drawn like Creepy's primary button but not pressable itself: the tap belongs to the wrapper
 * Onlang puts around it (`onlang://purchase`, for the selected plan).
 */
function PurchaseButton({ props }: ComponentProps<{ trial_title: string; paid_title: string }>) {
  const { period, busy, error } = usePaywallState();
  const title = planFor(period).hasFreeTrial ? props.trial_title : props.paid_title;
  return (
    <View style={styles.ctaWrap}>
      {error ? (
        <Text accessibilityLiveRegion="polite" variant="bodySmall" tone="danger" style={styles.message}>
          {error}
        </Text>
      ) : null}
      <View accessible accessibilityRole="button" accessibilityState={{ busy }} style={[styles.button, busy && styles.disabled]}>
        {busy ? <ActivityIndicator size="small" color={palette.onBrand} /> : null}
        <Text variant="button" tone="inverse">
          {busy ? 'Opening Play' : title}
        </Text>
      </View>
    </View>
  );
}

/**
 * Skipping is always available, and what it promises has to be true of this phone: "keep using
 * Creepy on this phone" only when on-device inference was chosen and the model is really there.
 * So this copy is the app's, not a token a hypothesis could rewrite.
 */
function SkipLink() {
  const { upgrade } = useLocalSearchParams<{ upgrade?: string }>();
  const { data: memoryProfile } = useQuery({ queryKey: ['memory-profile'], queryFn: getMemoryProfile, staleTime: Infinity });
  const { data: modelReady } = useQuery({
    queryKey: ['on-device-model-ready'],
    queryFn: async () => {
      const installed = await getInstalledModel();
      return installed ? verifyInstalled(installed) : false;
    },
    staleTime: Infinity,
  });
  const onDevice = memoryProfile !== 'cloud' && modelReady === true;
  const label = upgrade === '1' ? 'Not now' : onDevice ? 'Not now — keep using Creepy on this phone' : 'Not now — continue with Cloud';
  return (
    <View accessible accessibilityRole="button" accessibilityLabel={upgrade === '1' ? 'Not now, go back' : 'Not now, continue without Pro'} style={styles.skip}>
      <Text variant="label" tone="secondary" style={styles.center}>
        {label}
      </Text>
    </View>
  );
}

export const registry = new OnlangRegistry()
  .register('PaywallIntro', PaywallIntro)
  .register('PlanToggle', PlanToggle, { interactive: true })
  .register('PriceCard', PriceCard)
  .register('PurchaseButton', PurchaseButton)
  .register('SkipLink', SkipLink);

const styles = StyleSheet.create({
  intro: { alignItems: 'center', paddingHorizontal: gutter.screen, paddingTop: spacing.xxxl, paddingBottom: spacing.xxl },
  heading: { marginTop: spacing.sm, marginBottom: spacing.lg, textAlign: 'center' },
  center: { textAlign: 'center' },
  toggle: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.xs,
    marginHorizontal: gutter.screen,
    marginBottom: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: palette.neutralWash,
  },
  toggleOption: { flex: 1, minWidth: 0, alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md, borderRadius: radius.md },
  toggleOptionActive: { backgroundColor: palette.brand },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    marginHorizontal: gutter.screen,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
  },
  priceRow: { gap: spacing.xs },
  ctaWrap: { paddingHorizontal: gutter.screen, paddingTop: spacing.xl },
  message: { marginBottom: spacing.md, textAlign: 'center' },
  // Button.tsx's primary variant.
  button: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: palette.brand,
    ...shadow.raised,
  },
  disabled: { opacity: 0.45 },
  skip: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH_TARGET, marginTop: spacing.md, padding: spacing.md },
  pressed: { opacity: 0.75 },
});
