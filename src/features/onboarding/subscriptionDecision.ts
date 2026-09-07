/**
 * Paywall decision for the subscription step.
 *
 * The backend decides who must pay (`subscriptionRequired`). A missing value
 * must be read as "payment required" — the safe default — so only an explicit
 * `false` (a custdev / beta account) bypasses the paywall.
 */
export function shouldShowPaywall(
  subscriptionRequired: boolean | undefined,
): boolean {
  return subscriptionRequired !== false;
}