import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { disconnectUnentitledConnections } from '@/connections/connectionService';
import { CONNECTIONS_QUERY_KEY } from '@/connections/useConnections';
import { MCP_RUNTIME_QUERY_KEY } from '@/mcp/queryKeys';
import { isEntitled, useEntitlements } from './useEntitlements';

/**
 * Disconnect the paid accounts when the subscription is gone.
 *
 * Locking the connector tiles decided what a tap does and nothing else. Tools
 * follow the connection record, so an account linked while subscribed went on
 * feeding the planner — and went on being callable — after the subscription
 * lapsed. This closes that.
 *
 * Note the default, which is the opposite of the one the tiles use, and
 * deliberately:
 *
 *   - Locking a tile on an unanswered question is cheap to get wrong. The user
 *     taps once more and sees the offer, so absence of an answer reads as
 *     unpaid.
 *   - Tearing down a connection on an unanswered question is expensive to get
 *     wrong. It ends a TDLib session and discards an OAuth grant, and the way
 *     back is a full sign-in. A slow token refresh at launch, an offline
 *     start, a 500 — none of those are evidence that anyone stopped paying.
 *
 * So this acts only on an answer the server actually gave. `isSuccess` is the
 * whole of the condition; a failed or in-flight query does nothing at all.
 */
export function useEntitlementEnforcement(): void {
  const queryClient = useQueryClient();
  const { data, isSuccess } = useEntitlements();

  /*
   * One teardown per lapse, not one per render. `disconnectUnentitledConnections`
   * restarts the MCP runtime, which invalidates queries, which re-renders this
   * — an unguarded effect would chase its own tail.
   */
  const running = useRef(false);

  useEffect(() => {
    if (!isSuccess) return;
    if (isEntitled(data)) {
      // Re-armed, so a later lapse is acted on.
      running.current = false;
      return;
    }
    if (running.current) return;
    running.current = true;

    void disconnectUnentitledConnections().then((revoked) => {
      if (revoked.length === 0) return;
      void queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: MCP_RUNTIME_QUERY_KEY });
    });
  }, [data, isSuccess, queryClient]);
}
