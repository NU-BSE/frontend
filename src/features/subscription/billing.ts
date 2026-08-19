import { Platform } from 'react-native';
import type {
  ProductRequest,
  ProductSubscription,
  ProductSubscriptionAndroid,
  SubscriptionOffer,
} from 'react-native-iap';

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
  /**
   * The same amount in micros (1,000,000 = one unit).
   *
   * Carried so derived figures — a per-month equivalent, the annual saving —
   * can be computed in the currency the user is actually charged. Without it
   * the screen could only ever restate the USD list prices beside a localized
   * one, which is how "HK$99.00" ended up above "Billed $12.90 today".
   */
  amountMicros: number;
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

/*
 * Types come from the library, not from a local restatement of them.
 *
 * This seam used to declare its own `PlayProduct`/`PlayOffer` interfaces to
 * avoid pulling react-native-iap's shipped TypeScript source into the program.
 * That worked, and it hid a bug for the entire life of the paywall: the local
 * names — `subscriptionOfferDetailsAndroid`, `basePlanId`, `offerToken` — do
 * not exist in v16, which calls them `subscriptionOffers`, `basePlanIdAndroid`
 * and `offerTokenAndroid`. Every lookup silently found nothing, so the app
 * reported "Play has no active offer" for base plans that were published and
 * active, and the compiler was satisfied throughout, because a hand-written
 * interface agrees with whatever you wrote in it.
 *
 * `import type` from the package's declarations costs nothing at runtime and
 * makes the next upstream rename a compile error instead of a paywall that
 * cannot complete a purchase.
 */
interface IapModule {
  initConnection(): Promise<boolean>;
  // Declared as the library declares it, including the null and the iOS half
  // of the union. Narrowing it here to "Android subscriptions" would be
  // another convenient fiction, and the last one cost a working paywall.
  fetchProducts(params: ProductRequest): Promise<ProductSubscription[] | null>;
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

/** Narrow the store's answer to the Android subscriptions this seam handles. */
function androidSubscriptions(
  products: ProductSubscription[] | null,
): ProductSubscriptionAndroid[] {
  return (products ?? []).filter(
    (product): product is ProductSubscriptionAndroid =>
      product.platform === 'android',
  );
}

/**
 * The offers for a base plan.
 *
 * Play returns one offer for the base plan itself plus one per attached offer
 * — the free trial is a separate entry against the same base plan — so this
 * legitimately returns several.
 */
function offersForBasePlan(
  products: ProductSubscriptionAndroid[],
  basePlanId: string,
): SubscriptionOffer[] {
  return products
    .flatMap((product) => product.subscriptionOffers ?? [])
    .filter((offer) => offer?.basePlanIdAndroid === basePlanId);
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
    const subscriptions = androidSubscriptions(
      await iap.fetchProducts({ skus: [PLAY_SUBSCRIPTION_ID], type: 'subs' }),
    );
    const connected = await iap.initConnection();

    if (!connected) {
      console.warn('[RN-IAP] initConnection returned false');
      return {};
    }

    let subscriptions;

    try {
      subscriptions =
        (await iap.fetchProducts({
          skus: [PLAY_SUBSCRIPTION_ID],
          type: 'subs',
        })) ?? [];
    } catch (error) {
      console.warn(
        '[RN-IAP] fetchProducts failed, reconnecting once:',
        error,
      );

      // Re-establish connection after SERVICE_DISCONNECTED
      await iap.initConnection();

      subscriptions =
        (await iap.fetchProducts({
          skus: [PLAY_SUBSCRIPTION_ID],
          type: 'subs',
        })) ?? [];
    }

    const prices: Partial<Record<BillingPeriod, StorePrice>> = {};

    for (const period of ['monthly', 'annual'] as BillingPeriod[]) {
      const basePlanId = planFor(period).basePlanId;
      const phase = offersForBasePlan(subscriptions, basePlanId)
        .flatMap((offer) => offer.pricingPhasesAndroid?.pricingPhaseList ?? [])
        // Skip the free-trial phase, whose price is zero, and show what the
        // user will actually be charged when the trial ends.
        .find((item) => Number(item?.priceAmountMicros ?? 0) > 0);

      const offer = subscriptions
        .flatMap(
          (product) => product.subscriptionOfferDetailsAndroid ?? [],
        )
        .find((detail) => detail?.basePlanId === basePlanId);

      const phase = offer?.pricingPhases?.pricingPhaseList?.find(
        (item) => Number(item?.priceAmountMicros ?? 0) > 0,
      );

      if (phase?.formattedPrice) {
        prices[period] = {
          formattedPrice: String(phase.formattedPrice),
          currencyCode: String(phase.priceCurrencyCode ?? ''),
          amountMicros: Number(phase.priceAmountMicros ?? 0),
        };
      }
    }

    return prices;
  } catch (error) {
    console.warn('[RN-IAP] Unable to fetch store prices:', error);
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
    const products = androidSubscriptions(
      await iap.fetchProducts({ skus: [PLAY_SUBSCRIPTION_ID], type: 'subs' }),
    );
    const offers = offersForBasePlan(products, basePlanId);

    /*
     * Prefer the cheapest first phase, which is the free trial when Play has
     * attached one to this base plan and the user is eligible for it. Play
     * decides eligibility — someone who already used the trial simply will not
     * be offered it, and buying the base plan directly is then correct.
     */
    const offer =
      offers.find(
        (candidate) =>
          Number(
            candidate.pricingPhasesAndroid?.pricingPhaseList?.[0]
              ?.priceAmountMicros ?? -1,
          ) === 0,
      ) ?? offers[0];

    if (!offer?.offerTokenAndroid) {
      // Name what Play actually returned. "No active offer" was reported for
      // years against correctly published plans because the lookup was wrong,
      // and the message gave nothing to distinguish that from a real problem.
      const seen = products
        .flatMap((product) => product.subscriptionOffers ?? [])
        .map((entry) => entry.basePlanIdAndroid ?? '?')
        .join(', ');
      throw new BillingUnavailable(
        `Play returned no offer for base plan "${basePlanId}". ` +
          (products.length === 0
            ? `Play returned no products for "${PLAY_SUBSCRIPTION_ID}" at all — ` +
              'this build is usually not installed from Play, or the account is ' +
              'not a licensed tester.'
            : `Play offered: ${seen || 'nothing'}.`),
      );
    }

    const result = await iap.requestPurchase({
      request: {
        google: {
          skus: [PLAY_SUBSCRIPTION_ID],
          subscriptionOffers: [
            { sku: PLAY_SUBSCRIPTION_ID, offerToken: offer.offerTokenAndroid },
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
