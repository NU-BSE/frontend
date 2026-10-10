import type { PurchaseHandler } from '@onlang/react-native';

import { track } from '@/analytics';
import { getMySubscription, verifyPlayPurchase } from '@/api/client';
import { BillingUnavailable, PurchaseCancelled, purchase } from '@/features/subscription/billing';
import { isEntitled } from '@/features/subscription/entitlement';
import type { BillingPeriod } from '@/features/subscription/plans';

import { paywallState } from './paywallState';

const PERIODS: readonly string[] = ['annual', 'monthly'];

/**
 * Billing stays where it was: Onlang asks for a plan (the registry's products are the billing
 * periods) and records what happened. Verification is the backend's, exactly as on the classic
 * paywall: a purchase token is proof of payment to Play, not entitlement to Creepy.
 */
export const purchases: PurchaseHandler = {
  async purchase(product) {
    if (!PERIODS.includes(product)) return 'failed';
    const period = product as BillingPeriod;
    paywallState.set({ busy: true, error: null });
    try {
      const result = await purchase(period);
      track(period === 'annual' ? 'onboarding_trial_started' : 'onboarding_subscription_started', { period, source: 'onlang' });
      try {
        await verifyPlayPurchase({ purchaseToken: result.purchaseToken, productId: result.productId, basePlanId: result.basePlanId });
      } catch (verifyError) {
        // Paid, not yet activated: say so, and finish anyway (RTDN redelivers the purchase).
        paywallState.set({
          error: verifyError instanceof Error ? `Payment succeeded, but activation is still pending: ${verifyError.message}` : 'Payment succeeded, but activation is still pending.',
        });
      }
      return 'purchased';
    } catch (error) {
      if (error instanceof PurchaseCancelled) return 'cancelled';
      paywallState.set({
        error: error instanceof BillingUnavailable || error instanceof Error ? error.message : 'The purchase could not be completed.',
      });
      return 'failed';
    } finally {
      paywallState.set({ busy: false });
    }
  },

  /**
   * "Restore purchases" asks the backend, which is the only thing that grants anything: Play
   * redelivers purchases to it (RTDN), so an account that already paid is entitled there.
   */
  async restore() {
    try {
      const { entitlements } = await getMySubscription();
      const restored = isEntitled(entitlements);
      if (!restored) paywallState.set({ error: 'No active Creepy Pro subscription was found for this account.' });
      return restored;
    } catch (error) {
      paywallState.set({ error: error instanceof Error ? error.message : 'Could not check your subscription.' });
      return false;
    }
  },
};
