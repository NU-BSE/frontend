/**
 * The subscription plans, as published on creepy.im and in the Play Console.
 *
 * One product, two base plans. The free trial is an offer attached to the
 * annual plan only — monthly starts billing immediately — which is what the
 * Play Console actually has, so the app must not promise otherwise.
 *
 * Prices here are the marketing copy. Google Play is the source of truth for
 * what the user is charged, in their own currency, and the screen prefers
 * Play's localized price whenever the store answers. These are the fallback
 * for the moment before it does, and for platforms with no store.
 */

export type BillingPeriod = 'monthly' | 'annual';

export interface SubscriptionPlan {
  period: BillingPeriod;
  /**
   * Play base plan id — see PLAY_SUBSCRIPTION_ID.
   *
   * These must match the Play Console exactly. They are opaque ids, not
   * descriptions: the console generates `plan-1`, `plan-2`, and inventing
   * readable ones here made Play answer "no active offer" for a plan that was
   * published and active the whole time.
   */
  basePlanId: string;
  label: string;
  /** Fallback display price for the billing period. */
  listPrice: string;
  /** What that works out to per month, for comparison. */
  perMonth: string;
  /** Sub-line under the price. */
  caption: string;
  /** Shown on the toggle; empty for the plan with nothing to advertise. */
  badge?: string;
  /** Whether Play attaches a free-trial offer to this base plan. */
  hasFreeTrial: boolean;
  /** Label for the purchase button. */
  cta: string;
  /** Full-sentence billing terms, shown once a period is selected. */
  terms: string;
}

/** Length of the trial offer, which exists on the annual plan only. */
export const TRIAL_DAYS = 7;

/**
 * The Play subscription these base plans belong to. Both periods are base
 * plans of one subscription rather than two products, which is what lets Play
 * treat monthly↔annual as an upgrade/downgrade instead of a second purchase.
 */
export const PLAY_SUBSCRIPTION_ID = 'creepyim_pro';

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    period: 'monthly',
    basePlanId: 'plan-1',
    label: 'Monthly',
    listPrice: '$12.90',
    perMonth: '$12.90',
    caption: 'per month',
    hasFreeTrial: false,
    cta: 'Start',
    terms:
      'Billed $12.90 today and every month after. Cancel anytime. The free ' +
      'trial is on the annual plan.',
  },
  {
    period: 'annual',
    basePlanId: 'plan-2',
    label: 'Annual',
    listPrice: '$118.80',
    perMonth: '$9.90',
    caption: 'per month, billed annually',
    badge: 'Save $36',
    hasFreeTrial: true,
    cta: 'Start free',
    terms:
      'Free for 7 days, then $118.80 once per year — $9.90 per month, saving ' +
      '$36 against monthly. Cancel anytime before the trial ends and you are ' +
      'not charged.',
  },
];

export function planFor(period: BillingPeriod): SubscriptionPlan {
  const plan = SUBSCRIPTION_PLANS.find((entry) => entry.period === period);
  if (!plan) throw new Error(`no subscription plan for period "${period}"`);
  return plan;
}

/**
 * Annual saving against twelve months of the monthly plan.
 *
 * Derived rather than written down so the badge cannot drift from the prices
 * beside it — the site states $36, and this is what proves it.
 */
export function annualSavingUsd(): number {
  const monthly = Number(planFor('monthly').listPrice.replace(/[^0-9.]/gu, ''));
  const annual = Number(planFor('annual').listPrice.replace(/[^0-9.]/gu, ''));
  return Math.round((monthly * 12 - annual) * 100) / 100;
}
