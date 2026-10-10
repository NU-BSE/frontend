import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('@/features/subscription/billing', () => {
  class BillingUnavailable extends Error {}
  class PurchaseCancelled extends Error {}
  return { BillingUnavailable, PurchaseCancelled, purchase: jest.fn(), fetchStorePrices: jest.fn() };
});
jest.mock('@/api/client', () => ({ verifyPlayPurchase: jest.fn(), getMySubscription: jest.fn() }));
jest.mock('@/analytics', () => ({ track: jest.fn() }));
// The components' own imports (model install, prefs) are native-bound and not exercised here.
jest.mock('@/ai/modelInstall', () => ({ getInstalledModel: jest.fn(), verifyInstalled: jest.fn() }));
jest.mock('@/storage/prefs', () => ({ getMemoryProfile: jest.fn() }));

import * as billing from '@/features/subscription/billing';
import * as api from '@/api/client';
import { paywallState } from '../paywallState';
import { purchases } from '../purchases';
import { registry } from '../registry';
import { storeValues } from '../store';

const mocked = <T extends (...args: never[]) => unknown>(f: T) => f as unknown as jest.Mock;
const play = (formattedPrice: string, currencyCode: string, amountMicros: number) => ({ formattedPrice, currencyCode, amountMicros });

beforeEach(() => {
  jest.clearAllMocks();
  paywallState.reset();
});

describe('the Onlang project and the app agree', () => {
  const project = JSON.parse(readFileSync(join(__dirname, '../../../onlang/registry.json'), 'utf8'));

  it('registers every component of onlang/registry.json, with the same interactivity', () => {
    expect(registry.types.sort()).toEqual(Object.keys(project.components).sort());
    for (const [name, spec] of Object.entries<{ interactive?: boolean }>(project.components)) {
      expect([name, registry.isInteractive(name)]).toEqual([name, spec.interactive ?? false]);
    }
  });

  it('sells exactly the billing periods as products', () => {
    expect(project.products.sort()).toEqual(['annual', 'monthly']);
  });
});

describe('store values', () => {
  it("uses Play's prices for every placeholder when Play answers for both plans", async () => {
    mocked(billing.fetchStorePrices).mockResolvedValue({ annual: play('HK$939.00', 'HKD', 939e6), monthly: play('HK$99.00', 'HKD', 99e6) });
    expect(await storeValues(['annual', 'monthly'])).toEqual({
      price: { annual: 'HK$939.00', monthly: 'HK$99.00' },
      period: { annual: 'year', monthly: 'month' },
      trial: { annual: '7 days' },
    });
    expect(paywallState.get().prices.annual?.formattedPrice).toBe('HK$939.00');
  });

  it('never mixes currencies: with one plan from Play, both show the list prices', async () => {
    mocked(billing.fetchStorePrices).mockResolvedValue({ annual: play('HK$939.00', 'HKD', 939e6) });
    expect((await storeValues(['annual', 'monthly'])).price).toEqual({ annual: '$118.80', monthly: '$12.90' });
  });
});

describe('purchases', () => {
  const token = { purchaseToken: 'tok', productId: 'creepyim_pro', basePlanId: 'plan-2' };

  it('buys through Play, verifies with the backend and reports a purchase', async () => {
    mocked(billing.purchase).mockResolvedValue(token);
    mocked(api.verifyPlayPurchase).mockResolvedValue({});
    expect(await purchases.purchase('annual')).toBe('purchased');
    expect(billing.purchase).toHaveBeenCalledWith('annual');
    expect(api.verifyPlayPurchase).toHaveBeenCalledWith(token);
    expect(paywallState.get()).toMatchObject({ busy: false, error: null });
  });

  it('is still a purchase when activation fails, and says activation is pending', async () => {
    mocked(billing.purchase).mockResolvedValue(token);
    mocked(api.verifyPlayPurchase).mockRejectedValue(new Error('backend down'));
    expect(await purchases.purchase('annual')).toBe('purchased');
    expect(paywallState.get().error).toBe('Payment succeeded, but activation is still pending: backend down');
  });

  it('a cancel is quiet; a billing problem is shown', async () => {
    mocked(billing.purchase).mockRejectedValueOnce(new billing.PurchaseCancelled());
    expect(await purchases.purchase('monthly')).toBe('cancelled');
    expect(paywallState.get().error).toBeNull();
    mocked(billing.purchase).mockRejectedValueOnce(new billing.BillingUnavailable('In-app purchases are unavailable in this build.'));
    expect(await purchases.purchase('monthly')).toBe('failed');
    expect(paywallState.get().error).toBe('In-app purchases are unavailable in this build.');
  });

  it('refuses products that are not billing periods', async () => {
    expect(await purchases.purchase('lifetime')).toBe('failed');
    expect(billing.purchase).not.toHaveBeenCalled();
  });

  it('restore asks the backend whether this account is entitled', async () => {
    mocked(api.getMySubscription).mockResolvedValueOnce({ subscription: null, entitlements: { cloudAgentAllowed: true } });
    expect(await purchases.restore!()).toBe(true);
    mocked(api.getMySubscription).mockResolvedValueOnce({ subscription: null, entitlements: { cloudAgentAllowed: false } });
    expect(await purchases.restore!()).toBe(false);
    expect(paywallState.get().error).toMatch(/No active Creepy Pro subscription/);
  });
});
