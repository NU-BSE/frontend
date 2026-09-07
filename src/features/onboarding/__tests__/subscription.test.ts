import { shouldShowPaywall } from '@/features/onboarding/subscriptionDecision';
import { SUBSCRIPTION_PLANS, TRIAL_DAYS, planFor } from '@/features/subscription/plans';

describe('subscription paywall decision', () => {
  it('20. shows the paywall when payment is required', () => {
    expect(shouldShowPaywall(true)).toBe(true);
  });

  it('21. hides the paywall when the backend says not required', () => {
    expect(shouldShowPaywall(false)).toBe(false);
  });

  it('treats a missing value as payment required (safe default)', () => {
    expect(shouldShowPaywall(undefined)).toBe(true);
  });
});

describe('subscription plans', () => {
  it('annual carries the 7-day trial and its CTA', () => {
    expect(TRIAL_DAYS).toBe(7);
    expect(planFor('annual').hasFreeTrial).toBe(true);
    expect(planFor('annual').cta).toBe('Start 7-day free trial');
  });

  it('monthly has no trial and the "Continue monthly" CTA', () => {
    expect(planFor('monthly').hasFreeTrial).toBe(false);
    expect(planFor('monthly').cta).toBe('Continue monthly');
  });

  it('both periods are one subscription with two base plans', () => {
    expect(SUBSCRIPTION_PLANS.map((p) => p.period).sort()).toEqual([
      'annual',
      'monthly',
    ]);
  });
});
