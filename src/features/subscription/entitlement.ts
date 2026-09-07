import type { Entitlements } from '@/api/client';

/**
 * Whether this account holds the paid product.
 *
 * Read off the two fields the backend actually sets, rather than a plan name
 * the client would have to keep in step:
 *
 *  - `subscriptionRequired === false` is the exemption — store-review
 *    accounts, which hold everything with no subscription row at all.
 *  - `cloudAgentAllowed` is what separates the seeded `free` plan from `pro`
 *    and `pro_annual`. With no active subscription the server answers
 *    `cloud_agent_allowed: false, plan_code: null`, so "no plan" and "the free
 *    plan" resolve the same way, which is what we want.
 *
 * Undefined means the question has not been answered — the query is in flight,
 * or it failed. That reads as **not** entitled: showing the offer to someone
 * who has already paid costs them a tap, and the reverse gives the product
 * away to anyone who can drop a packet.
 *
 * Pure, and separate from the hook, so the rule can be exercised without
 * dragging in the API client and the keystore behind it.
 */
export function isEntitled(entitlements: Entitlements | undefined): boolean {
  if (!entitlements) return false;
  if (entitlements.subscriptionRequired === false) return true;
  return entitlements.cloudAgentAllowed === true;
}
