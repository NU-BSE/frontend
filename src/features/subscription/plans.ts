/**
 * The subscription plans, as published on creepy.im.
 *
 * One plan, two billing periods, seven days free either way. The prices here
 * are the marketing copy — Google Play is the source of truth for what the
 * user is actually charged, in their own currency, and the screen prefers
 * Play's localized price string whenever the store answers. These act as the
 * fallback for the moment before the store responds, and on platforms with no
 * store at all.
 */

export type BillingPeriod = 'monthly' | 'annual';

export interface SubscriptionPlan {
  period: BillingPeriod;
  /** Play base plan id — see PLAY_SUBSCRIPTION_ID. */
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
  /** Full-sentence billing terms, shown once a period is selected. */
  terms: string;
}

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
    basePlanId: 'creepyim-pro-monthly',
    label: 'Monthly',
    listPrice: '$12.90',
    perMonth: '$12.90',
    caption: 'per month after trial',
    terms:
      'Billed $12.90 every month after your trial ends. Cancel anytime before ' +
      'then and you are not charged.',
  },
  {
    period: 'annual',
    basePlanId: 'creepyim-pro-annual',
    label: 'Annual',
    listPrice: '$118.80',
    perMonth: '$9.90',
    caption: 'per month, billed annually',
    badge: 'Save $36',
    terms:
      'Billed $118.80 once per year after your trial ends — $9.90 per month, ' +
      'saving $36 against monthly. Cancel anytime before then and you are not ' +
      'charged.',
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
