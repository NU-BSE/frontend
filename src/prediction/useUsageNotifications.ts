import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { hasPermission as canPostCards, showCard } from '@/notifications/smartCards';
import { hasPermission as canReadUsage, recentUsage } from '@/usage/usageStats';

import { cardForNextCategory } from './schedule';
import type { ModelBundle } from './inference';

/**
 * Turns real usage history into the predicted-category notification.
 *
 * The predictor, the card builder and the notification module all existed and
 * were connected to nothing. This is the join: read usage, ask the model what
 * is due, post a card if anything is.
 *
 * Runs on foreground rather than on a timer. A background job would need a
 * foreground service or WorkManager to survive Doze, and neither is justified
 * for a suggestion — if the user is not holding the phone, the notification
 * can wait until they are.
 */

/**
 * The shortest gap between two of these notifications.
 *
 * Without it, every return to the app could post a card, and a suggestion that
 * arrives repeatedly stops reading as a suggestion. Six hours is long enough
 * that a card is an event rather than a fixture.
 */
export const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface UsageNotificationOptions {
  bundle: ModelBundle | null;
  /** Set false to keep the machinery inert (settings, tests, onboarding). */
  enabled?: boolean;
}

export function useUsageNotifications({
  bundle,
  enabled = true,
}: UsageNotificationOptions): void {
  /*
   * Held in a ref, not state: this only gates a side effect and must not cause
   * a render. It is deliberately per-process — a cross-restart record belongs
   * in storage, and until the cadence is proven on real devices an in-memory
   * limit is the conservative choice, since it can only post *less* often than
   * intended after a restart, never more.
   */
  const lastPostedAt = useRef<number>(0);

  const maybePost = useCallback(async () => {
    if (!enabled || !bundle) return;
    if (Date.now() - lastPostedAt.current < MIN_INTERVAL_MS) return;

    // Both grants are checked before any work: reading usage without access
    // returns an empty list, which would look like a user who opens nothing.
    if (!(await canReadUsage())) return;
    if (!(await canPostCards())) return;

    const events = await recentUsage();
    if (events.length === 0) return;

    const card = cardForNextCategory(bundle, events, Math.floor(Date.now() / 1000));
    if (!card) return;

    lastPostedAt.current = Date.now();
    try {
      await showCard(card);
    } catch {
      /*
       * A failed post must not burn the interval — but it also must not retry
       * in a loop. Resetting to zero lets the next foreground try again, which
       * is the behaviour a transient failure deserves.
       */
      lastPostedAt.current = 0;
    }
  }, [bundle, enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    void maybePost();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void maybePost();
    });
    return () => subscription.remove();
  }, [enabled, maybePost]);
}
