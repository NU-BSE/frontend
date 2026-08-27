import { NativeModules, Platform } from 'react-native';

import type { UsageEvent } from '@/prediction/schedule';

/**
 * Real app-usage history for the cold-start predictor.
 *
 * The predictor and its notification scheduling already existed; until now
 * nothing supplied them with events, so they were exercised only by fixtures.
 * This is their first real source.
 *
 * Usage access is not a runtime permission. There is no dialog: the user
 * grants it on a system screen, and the app only learns the outcome by
 * re-checking when it returns to the foreground. `openSettings` therefore does
 * not resolve to a decision, and callers must poll `hasPermission`.
 */

type NativeUsage = {
  hasPermission(): Promise<boolean>;
  openSettings(): Promise<boolean>;
  queryEvents(sinceMs: number, untilMs: number): Promise<UsageEvent[]>;
};

const native = (NativeModules.UsageStats as NativeUsage | undefined) ?? null;

export function isSupported(): boolean {
  return Platform.OS === 'android' && native != null;
}

export async function hasPermission(): Promise<boolean> {
  if (!isSupported()) return false;
  return native!.hasPermission();
}

/** Opens the system usage-access screen. Cannot report what the user chose. */
export async function openSettings(): Promise<boolean> {
  if (!isSupported()) return false;
  return native!.openSettings();
}

/**
 * How much history the predictor is given.
 *
 * Fourteen days covers weekly rhythms — the "Monday morning" shape the model
 * is built around — without dragging in habits the user has since dropped.
 * The platform keeps only a few weeks anyway and clamps a wider window
 * silently.
 */
export const HISTORY_DAYS = 14;

/**
 * Recent foreground events, oldest first.
 *
 * Returns an empty array rather than throwing when access has not been
 * granted, because "no history" and "not allowed to see history" lead to the
 * same behaviour in the caller: predict nothing. The distinction is available
 * through `hasPermission` for UI that needs to explain itself.
 */
export async function recentUsage(days = HISTORY_DAYS): Promise<UsageEvent[]> {
  if (!isSupported()) return [];
  if (!(await hasPermission())) return [];

  const until = Date.now();
  const since = until - days * 24 * 60 * 60 * 1000;
  try {
    const events = await native!.queryEvents(since, until);
    // Oldest first: the predictor works on gaps between consecutive uses, and
    // the platform's ordering is not contractual.
    return [...events].sort((a, b) => a.at - b.at);
  } catch {
    return [];
  }
}
