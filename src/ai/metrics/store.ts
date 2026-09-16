import AsyncStorage from '@react-native-async-storage/async-storage';

import { sanitizeMetricsEvent } from './allowlist';
import type { ExportedMetricsPayload, MetricsEvent } from './types';

export const METRICS_STORAGE_KEY = 'creepyim.ai.metrics.v1';
export const MAX_STORED_EVENTS = 200;

let writeQueuePromise: Promise<void> = Promise.resolve();

/**
 * Flush all queued metric write operations sequentially.
 * Useful for deterministic testing and clean shutdown.
 */
export async function flushMetricsQueue(): Promise<void> {
  await writeQueuePromise;
}

/**
 * Reads stored metrics events from AsyncStorage.
 * Filters out corrupted or non-allowlisted entries.
 */
export async function readMetricsLog(): Promise<MetricsEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(METRICS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const validEvents: MetricsEvent[] = [];
    for (const item of parsed) {
      const sanitized = sanitizeMetricsEvent(item);
      if (sanitized) {
        validEvents.push(sanitized);
      }
    }
    return validEvents;
  } catch {
    return [];
  }
}

/**
 * Appends a privacy-sanitized metrics event to local storage.
 * Maintains bounded retention (max 200 events).
 * Serialized via a promise chain to prevent race conditions during concurrent writes.
 * Non-blocking for caller, but guarantees sequential execution order.
 */
export async function recordMetricsEvent(rawEvent: unknown): Promise<void> {
  const sanitized = sanitizeMetricsEvent(rawEvent);
  if (!sanitized) return;

  writeQueuePromise = writeQueuePromise.then(async () => {
    try {
      const existing = await readMetricsLog();
      existing.push(sanitized);
      if (existing.length > MAX_STORED_EVENTS) {
        existing.splice(0, existing.length - MAX_STORED_EVENTS);
      }
      await AsyncStorage.setItem(METRICS_STORAGE_KEY, JSON.stringify(existing));
    } catch {
      // Non-fatal.
    }
  });

  await writeQueuePromise;
}

/**
 * Clears all stored metrics events from local storage.
 */
export async function clearMetrics(): Promise<void> {
  try {
    await AsyncStorage.removeItem(METRICS_STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}

/**
 * Generates an allowlisted export payload of stored metrics.
 * Runs each event through the allowlist filter again to enforce privacy guarantees.
 */
export async function exportMetrics(): Promise<ExportedMetricsPayload> {
  const events = await readMetricsLog();
  const sanitizedEvents = events
    .map((e) => sanitizeMetricsEvent(e))
    .filter((e): e is MetricsEvent => e !== null);

  return {
    schemaVersion: 1,
    exportedAt: Date.now(),
    events: sanitizedEvents,
  };
}
