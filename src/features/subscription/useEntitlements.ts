import { useQuery } from '@tanstack/react-query';

import { getMySubscription, type Entitlements } from '@/api/client';

export const ENTITLEMENTS_QUERY_KEY = ['entitlements'] as const;

export { isEntitled } from './entitlement';

/**
 * What this account is entitled to, as the server sees it.
 *
 * The app reads; it never decides. Nothing is cached to disk and no local
 * "subscribed" flag is written, because a flag on the device is a flag a user
 * can flip.
 */
export function useEntitlements() {
  return useQuery({
    queryKey: ENTITLEMENTS_QUERY_KEY,
    queryFn: async (): Promise<Entitlements> => {
      const { entitlements } = await getMySubscription();
      return entitlements;
    },
    // A gate that opens when the network fails is not a gate. One attempt,
    // then `isEntitled` treats the missing answer as unpaid.
    retry: false,
    staleTime: 5 * 60_000,
  });
}
