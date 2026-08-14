import { Platform } from 'react-native';

import {
  PLAY_SUBSCRIPTION_ID,
  planFor,
  type BillingPeriod,
} from './plans';

/**
 * Google Play billing, behind a narrow seam.
 *
 * `react-native-iap` is imported lazily and defensively: it is a native module,
 * so it is absent on web, absent in Node (the verify scripts bundle this
 * module's callers), and absent from any build made before it was added. A
 * static import would break all three. Everything here resolves to an honest
 * "unavailable" instead.
 *
 * WHAT THIS DOES NOT DO — a purchase is only proof of payment to the client.
 * Entitlement must be granted by the backend after it verifies the purchase
 * token with the Play Developer API, and kept current with Real-time developer
 * notifications for renewals, cancellations, refunds and grace periods. The
 * backend has neither today (`/subscriptions` seeds plans and reads
 * entitlement, but knows nothing about Play), so `purchase()` deliberately
 * returns the token for the caller to submit rather than flipping any local
 * "subscribed" flag. Treating a client-reported purchase as entitlement is
 * trivially spoofable.
 */

export interface StorePrice {
  /** Play's localized price for the period, e.g. "£10.99". */
  formattedPrice: string;
  currencyCode: string;
}

export interface PurchaseResult {
  /** Opaque token the backend must verify with the Play Developer API. */
  purchaseToken: string;
  productId: string;
  basePlanId: string;
}

export class BillingUnavailable extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'BillingUnavailable';
  }
}

export class PurchaseCancelled extends Error {
  constructor() {
    super('Purchase was cancelled.');
    this.name = 'PurchaseCancelled';
  }
}

/**
 * Only the surface this seam uses, declared locally rather than imported from
 * the package.
 *
 * `typeof import('react-native-iap')` drags the library's own TypeScript
 * *source* into the program — it ships `src/` alongside its declarations — and
 * that source does not compile under this tsconfig (`Cannot find name
 * 'global'`), breaking `npm run typecheck` for the whole repo. A narrow local
 * interface is also the honest shape of a seam: it states exactly what we
 * depend on, so a breaking change upstream surfaces here rather than
 * everywhere.
 */
interface IapModule {
  initConnection(): Promise<boolean>;
  fetchProducts(params: {
    skus: string[];
    type: 'subs' | 'in-app';
  }): Promise<PlayProduct[] | null>;
  requestPurchase(params: {
    request: {
      google: {
        skus: string[];
        subscriptionOffers: { sku: string; offerToken: string }[];
      };
    };
    type: 'subs';
  }): Promise<unknown>;
}

interface PlayPricingPhase {
  formattedPrice?: string;
  priceCurrencyCode?: string;
  priceAmountMicros?: string | number;
}

interface PlayOffer {
  basePlanId?: string;
  offerToken?: string;
  pricingPhases?: { pricingPhaseList?: PlayPricingPhase[] };
}

interface PlayProduct {
  subscriptionOfferDetailsAndroid?: PlayOffer[] | null;
}

let modulePromise: Promise<IapModule | null> | null = null;

async function loadIap(): Promise<IapModule | null> {
  if (Platform.OS !== 'android') return null;
  if (!modulePromise) {
    modulePromise = (import('react-native-iap') as Promise<unknown>)
      .then((mod) => mod as IapModule)
      .catch(() => null);
  }
  return modulePromise;
}

/** Whether a purchase can be attempted at all on this build and platform. */
export async function isBillingAvailable(): Promise<boolean> {
  return (await loadIap()) !== null;
}

/**
 * Play's own localized prices, keyed by billing period.
 *
 * Returns an empty map when the store cannot be reached, so callers fall back
 * to the marketing prices rather than showing nothing. A price the store did
 * not confirm is a price we should not present as authoritative, but a blank
 * paywall is worse than an approximate one clearly labelled.
 */
export async function fetchStorePrices(): Promise<
  Partial<Record<BillingPeriod, StorePrice>>
> {
  const iap = await loadIap();
  if (!iap) return {};

  try {
    await iap.initConnection();
    const subscriptions =
      (await iap.fetchProducts({ skus: [PLAY_SUBSCRIPTION_ID], type: 'subs' })) ?? [];

    const prices: Partial<Record<BillingPeriod, StorePrice>> = {};
    for (const period of ['monthly', 'annual'] as BillingPeriod[]) {
      const basePlanId = planFor(period).basePlanId;
      const offer = subscriptions
        .flatMap((product) => product.subscriptionOfferDetailsAndroid ?? [])
        .find((detail) => detail?.basePlanId === basePlanId);
      const phase = offer?.pricingPhases?.pricingPhaseList?.find(
        // Skip the free-trial phase, whose price is zero, and show what the
        // user will actually be charged when the trial ends.
        (item) => Number(item?.priceAmountMicros ?? 0) > 0,
      );
      if (phase?.formattedPrice) {
        prices[period] = {
          formattedPrice: String(phase.formattedPrice),
          currencyCode: String(phase.priceCurrencyCode ?? ''),
        };
      }
    }
    return prices;
  } catch {
    return {};
  }
}

/**
 * Launch Play's purchase flow for one billing period.
 *
 * Resolves with the purchase token once Play reports success. The caller is
 * responsible for sending it to the backend for verification — until that
 * exists, nothing should treat this as entitlement.
 */
export async function purchase(period: BillingPeriod): Promise<PurchaseResult> {
  const iap = await loadIap();
  if (!iap) {
    throw new BillingUnavailable(
      Platform.OS === 'android'
        ? 'In-app purchases are unavailable in this build.'
        : 'Subscriptions can only be purchased from the Android app.',
    );
  }

  const { basePlanId } = planFor(period);

  try {
    await iap.initConnection();
    const products =
      (await iap.fetchProducts({ skus: [PLAY_SUBSCRIPTION_ID], type: 'subs' })) ?? [];
    const offer = products
      .flatMap((product) => product.subscriptionOfferDetailsAndroid ?? [])
      .find((detail) => detail?.basePlanId === basePlanId);

    if (!offer?.offerToken) {
      throw new BillingUnavailable(
        `Play has no active offer for "${basePlanId}". Check the base plan is ` +
          'published in the Play Console.',
      );
    }

    const result = await iap.requestPurchase({
      request: {
        google: {
          skus: [PLAY_SUBSCRIPTION_ID],
          subscriptionOffers: [
            { sku: PLAY_SUBSCRIPTION_ID, offerToken: offer.offerToken },
          ],
        },
      },
      type: 'subs',
    });

    const entry = (Array.isArray(result) ? result[0] : result) as
      | { purchaseToken?: string; purchaseTokenAndroid?: string }
      | undefined;
    const purchaseToken = entry?.purchaseToken ?? entry?.purchaseTokenAndroid;
    if (!purchaseToken) {
      throw new BillingUnavailable('Play returned no purchase token.');
    }

    return { purchaseToken: String(purchaseToken), productId: PLAY_SUBSCRIPTION_ID, basePlanId };
  } catch (error) {
    if (error instanceof BillingUnavailable) throw error;
    const code = (error as { code?: string })?.code ?? '';
    if (/cancel/iu.test(code) || /cancel/iu.test(String((error as Error)?.message))) {
      throw new PurchaseCancelled();
    }
    throw error;
  }
}
