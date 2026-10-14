import type { StoreProvider } from '@onlang/react-native';

import { fetchStorePrices } from '@/features/subscription/billing';
import { TRIAL_DAYS } from '@/features/subscription/plans';
import { resolvePricing } from '@/features/subscription/pricing';

import { paywallState } from './paywallState';

const STORE_TIMEOUT_MS = 3000;

/**
 * Store values for the flow's `{{price|period|trial.<plan>}}` placeholders.
 *
 * The same rule as the classic paywall: every figure from Play, or every figure from the
 * marketing copy, never a mix (`resolvePricing`). The prices are also handed to the components
 * through `paywallState`, so the server's disclosure line and the app's price card can't disagree.
 */
export const storeValues: StoreProvider = async () => {
  // The flow waits for these, so a slow or absent Play (a reconnect, no account) can't hold the
  // paywall on a spinner: after STORE_TIMEOUT_MS it shows the marketing figures, like the classic one.
  const prices = await Promise.race([
    fetchStorePrices(),
    new Promise<Awaited<ReturnType<typeof fetchStorePrices>>>((resolve) => setTimeout(() => resolve({}), STORE_TIMEOUT_MS)),
  ]);
  paywallState.set({ prices });
  const pricing = resolvePricing(prices);
  return {
    price: { annual: pricing.price('annual'), monthly: pricing.price('monthly') },
    period: { annual: 'year', monthly: 'month' },
    // The trial is an offer on the annual base plan only (plans.ts).
    trial: { annual: `${TRIAL_DAYS} days` },
  };
};
