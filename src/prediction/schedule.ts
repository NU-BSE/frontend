import { categoryFor, packagesIn } from './categories';
import { NotEnoughHistory, predict, type ModelBundle } from './inference';
import type { SmartCard } from '@/notifications/smartCards';

/**
 * Turning usage history into a notification.
 *
 * The card used to be a hardcoded prompt with hardcoded buttons. Now the
 * content is derived: the predictor says when each category is next likely to
 * be used, the category that is due soonest wins, and the card names the apps
 * in that category. Adding a connector changes the card by changing the data
 * it is built from, not by editing a string.
 *
 * A category the user has never touched produces nothing at all. Suggesting
 * Telegram to someone who has never opened it is not a prediction, it is an
 * advertisement, and the model has no history to justify it.
 */

/** One recorded use of an app, from the agent's tool logs. */
export interface UsageEvent {
  /** Android package the MCP server acted on. */
  packageName: string;
  /** Unix seconds. */
  at: number;
}

export interface DueCategory {
  category: string;
  /** Unix seconds when the category is predicted to be used next. */
  predictedAt: number;
  /** Seconds from now. Negative means the moment has already passed. */
  inSeconds: number;
  /** Labels of the apps in this category the user actually uses. */
  apps: string[];
}

/**
 * How far ahead a prediction still counts as "soon".
 *
 * Beyond this the notification would arrive long before it is useful, and a
 * card the user cannot act on yet is just an interruption.
 */
export const HORIZON_SECONDS = 60 * 60 * 2;

/**
 * How stale a prediction may be before it is dropped.
 *
 * A moment that passed hours ago is not a reason to interrupt someone now.
 */
export const STALENESS_SECONDS = 60 * 30;

function sortedUniqueTimes(events: UsageEvent[]): number[] {
  return [...new Set(events.map((event) => Math.floor(event.at)))].sort((a, b) => a - b);
}

/** Group usage by the category of the app it touched, dropping unknown apps. */
export function groupByCategory(events: UsageEvent[]): Map<string, UsageEvent[]> {
  const grouped = new Map<string, UsageEvent[]>();
  for (const event of events) {
    const known = categoryFor(event.packageName);
    if (!known) continue;
    const list = grouped.get(known.category) ?? [];
    list.push(event);
    grouped.set(known.category, list);
  }
  return grouped;
}

/**
 * The categories predicted to be used soon, soonest first.
 *
 * A category whose history is too short to feature-extract is skipped rather
 * than guessed at — that is the predictor's own rule, and overriding it here
 * would invent a prediction the model declined to make.
 */
export function dueCategories(
  bundle: ModelBundle,
  events: UsageEvent[],
  now: number,
): DueCategory[] {
  const due: DueCategory[] = [];

  for (const [category, categoryEvents] of groupByCategory(events)) {
    const times = sortedUniqueTimes(categoryEvents);
    let prediction;
    try {
      prediction = predict(bundle, category, times);
    } catch (error) {
      if (error instanceof NotEnoughHistory) continue;
      throw error;
    }

    const inSeconds = prediction.predictedAt - now;
    if (inSeconds > HORIZON_SECONDS) continue;
    if (inSeconds < -STALENESS_SECONDS) continue;

    const used = new Set(categoryEvents.map((event) => event.packageName));
    due.push({
      category,
      predictedAt: prediction.predictedAt,
      inSeconds,
      apps: packagesIn(category)
        .filter((entry) => used.has(entry.packageName))
        .map((entry) => entry.label),
    });
  }

  return due.sort((a, b) => a.inSeconds - b.inSeconds);
}

function joinApps(apps: string[]): string {
  if (apps.length <= 1) return apps[0] ?? 'your apps';
  return `${apps.slice(0, -1).join(', ')} or ${apps[apps.length - 1]}`;
}

/**
 * Build the card for whichever category is due.
 *
 * Returns null when nothing is due — the caller posts nothing rather than
 * inventing a reason to interrupt.
 */
export function cardForNextCategory(
  bundle: ModelBundle,
  events: UsageEvent[],
  now: number,
): SmartCard | null {
  const [next] = dueCategories(bundle, events, now);
  if (!next || next.apps.length === 0) return null;

  const apps = joinApps(next.apps);
  return {
    title: 'Have you read recent messages?',
    text: `You usually check ${apps} around now.`,
    actions: next.apps.slice(0, 3).map((app) => ({
      id: `open:${next.category}:${app}`,
      label: `Check ${app}`,
      next: {
        title: app,
        text: `Opening ${app} is up to you — Creepy only noticed the pattern.`,
        detail: next.category.toLowerCase().replace(/_/gu, ' '),
        actions: [{ id: `dismiss:${next.category}`, label: 'Done' }],
      },
    })),
  };
}
