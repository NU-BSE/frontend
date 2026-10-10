import { useSyncExternalStore } from 'react';

import type { StorePrice } from '@/features/subscription/billing';
import type { BillingPeriod } from '@/features/subscription/plans';

/**
 * What the Onlang paywall's components share.
 *
 * Onlang places the components and words them; it does not hold app state. The plan toggle, the
 * price card and the purchase button still have to agree on the selected period, on whether Play
 * is open, and on the prices Play returned, so they read one small store here, the way the
 * classic screen reads its own `useState`s.
 */
export interface PaywallState {
  period: BillingPeriod;
  busy: boolean;
  error: string | null;
  /** Play's prices, as `store.ts` fetched them for the flow's placeholders. */
  prices: Partial<Record<BillingPeriod, StorePrice>>;
}

const initial: PaywallState = { period: 'annual', busy: false, error: null, prices: {} };

let state = initial;
const listeners = new Set<() => void>();

export const paywallState = {
  get: (): PaywallState => state,
  set(patch: Partial<PaywallState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  },
  /** A fresh paywall: keeps the prices, forgets the rest. */
  reset(period: BillingPeriod = 'annual'): void {
    paywallState.set({ ...initial, period, prices: state.prices });
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function usePaywallState(): PaywallState {
  return useSyncExternalStore(paywallState.subscribe, paywallState.get);
}
