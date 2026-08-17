import type { StorePrice } from './billing';
import { TRIAL_DAYS, planFor, type BillingPeriod } from './plans';

/**
 * One consistent set of figures for the paywall.
 *
 * The screen used to mix two sources: Play's localized price for the headline
 * and the USD list prices for everything derived from it. A user in Hong Kong
 * read "HK$99.00" above "Billed $12.90 today and every month after", and the
 * "Save $36" badge quoted a saving in a currency they would never be charged.
 *
 * So every figure comes from the same place. When the store answers, all of
 * them are computed from its amounts and rendered in its currency; when it
 * does not, all of them fall back to the marketing copy. The two are never
 * mixed within a sentence, and never across the screen.
 */

const MICROS_PER_UNIT = 1_000_000;
const MONTHS_PER_YEAR = 12;

export interface PaywallPricing {
  /** Headline price for a period. */
  price(period: BillingPeriod): string;
  /** The annual plan expressed per month, for comparison with monthly. */
  perMonth: string;
  /** Badge on the annual toggle, or undefined when there is nothing to claim. */
  badge(period: BillingPeriod): string | undefined;
  /** Full billing terms for the selected period. */
  terms(period: BillingPeriod): string;
  /** True when every figure above came from the store. */
  fromStore: boolean;
}

/**
 * Format an amount in the store's currency.
 *
 * Intl is available in Hermes, but a missing locale data set or an unusual
 * currency code should degrade to something readable rather than throw inside
 * a render. The fallback keeps the code visible so the number is never
 * ambiguous about what it is denominated in.
 */
function formatMoney(micros: number, currencyCode: string): string {
  const amount = micros / MICROS_PER_UNIT;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      // Play prices are whole units far more often than not; showing
      // "HK$939" rather than "HK$939.00" would not match the store's own
      // rendering, so the usual two places are kept.
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}

/** The marketing figures, used whenever the store has not answered. */
function fallbackPricing(): PaywallPricing {
  const annual = planFor('annual');
  return {
    price: (period) => planFor(period).listPrice,
    perMonth: annual.perMonth,
    badge: (period) => planFor(period).badge,
    terms: (period) => planFor(period).terms,
    fromStore: false,
  };
}

export function resolvePricing(
  storePrices: Partial<Record<BillingPeriod, StorePrice>>,
): PaywallPricing {
  const monthly = storePrices.monthly;
  const annual = storePrices.annual;

  /*
   * Both periods or neither. With only one, the screen would compare a
   * localized price against a USD one and present the difference as a saving,
   * which is worse than showing the marketing figures for both.
   */
  if (
    !monthly?.amountMicros ||
    !annual?.amountMicros ||
    monthly.currencyCode !== annual.currencyCode
  ) {
    return fallbackPricing();
  }

  const currency = annual.currencyCode;
  const perMonthMicros = Math.round(annual.amountMicros / MONTHS_PER_YEAR);
  const savingMicros = monthly.amountMicros * MONTHS_PER_YEAR - annual.amountMicros;

  const annualPrice = annual.formattedPrice;
  const monthlyPrice = monthly.formattedPrice;
  const perMonth = formatMoney(perMonthMicros, currency);
  const saving = formatMoney(savingMicros, currency);

  return {
    price: (period) => (period === 'annual' ? annualPrice : monthlyPrice),
    perMonth,
    // Only claim a saving when there is one. Play prices are set per country
    // and nothing guarantees the annual plan is cheaper in every one of them.
    badge: (period) =>
      period === 'annual' && savingMicros > 0 ? `Save ${saving}` : undefined,
    terms: (period) =>
      period === 'annual'
        ? `Free for ${TRIAL_DAYS} days, then ${annualPrice} once per year — ` +
          `${perMonth} per month` +
          (savingMicros > 0 ? `, saving ${saving} against monthly` : '') +
          '. Cancel anytime before the trial ends and you are not charged.'
        : `Billed ${monthlyPrice} today and every month after. Cancel ` +
          'anytime. The free trial is on the annual plan.',
    fromStore: true,
  };
}
