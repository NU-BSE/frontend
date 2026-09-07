import type { ScenarioId } from '@/features/scenarios/registry';
import type { OnboardingIntentId } from '@/storage/prefs';

/**
 * Suggested first tasks for the "Let's try Creepy" screen.
 *
 * Suggestions are built from what is *actually available*: the user's chosen
 * interests plus the integrations that are really connected. A Telegram task
 * only appears once Telegram is connected, and a Calendar/Drive task only once
 * Google is connected — a suggestion that ends in "please connect a service"
 * is not a first-run experience, it is a dead end.
 */
export interface FirstTaskSuggestion {
  id: string;
  title: string;
  scenarioId: ScenarioId | null;
}

export const ANDROID_SUGGESTIONS: FirstTaskSuggestion[] = [
  {
    id: 'android_battery',
    title: "Find what's draining my battery",
    scenarioId: 'settings',
  },
  {
    id: 'android_setting',
    title: 'Help me find a setting',
    scenarioId: 'settings',
  },
  {
    id: 'android_notifications',
    title: 'Stop an app from bothering me with notifications',
    scenarioId: 'settings',
  },
];

export const TELEGRAM_SUGGESTION: FirstTaskSuggestion = {
  id: 'telegram_catchup',
  title: 'Catch me up on Telegram',
  scenarioId: 'messaging',
};

export const CALENDAR_SUGGESTION: FirstTaskSuggestion = {
  id: 'calendar_today',
  title: "What's on my calendar today?",
  scenarioId: 'calendar',
};

export const DRIVE_SUGGESTION: FirstTaskSuggestion = {
  id: 'drive_find_file',
  title: 'Find a file in my Drive',
  scenarioId: 'drive',
};

/** Lightweight projection so tests do not need the connector runtime. */
export interface ConnectionLike {
  connectorId: string;
  status: string;
}

const isConnected = (connectorId: string) => (connections: ConnectionLike[]) =>
  connections.some(
    (connection) =>
      connection.connectorId === connectorId &&
      connection.status === 'connected',
  );

/**
 * Build the 3–5 tasks shown on the first-task screen.
 *
 * Interest selection drives which tasks are candidates; only tasks whose
 * required integration is really connected are included. Android tasks are the
 * default base (the Settings connector is always available), capped at five so
 * the screen never becomes a wall.
 */
export function buildFirstTaskSuggestions(input: {
  intents: OnboardingIntentId[];
  connections: ConnectionLike[];
}): FirstTaskSuggestion[] {
  const wants = (id: OnboardingIntentId) => input.intents.includes(id);
  const connected = isConnected;

  const suggestions: FirstTaskSuggestion[] = [];

  if (wants('android_settings')) suggestions.push(...ANDROID_SUGGESTIONS);
  if (wants('messages') && connected('telegram-user')(input.connections)) {
    suggestions.push(TELEGRAM_SUGGESTION);
  }
  if (wants('calendar') && connected('google')(input.connections)) {
    suggestions.push(CALENDAR_SUGGESTION);
  }
  if (wants('drive') && connected('google')(input.connections)) {
    suggestions.push(DRIVE_SUGGESTION);
  }

  return suggestions.slice(0, 5);
}

/**
 * The chat route a first task opens. Reuses the real chat (source=onboarding)
 * with the task's title as the prompt and its scenario for the chat chrome;
 * the custom "Ask something else" path passes no scenario.
 */
export function buildFirstTaskChatUrl(
  task: FirstTaskSuggestion,
): string {
  const query = [
    'source=onboarding',
    `task=${task.id}`,
    task.scenarioId ? `scenario=${task.scenarioId}` : null,
    `prompt=${encodeURIComponent(task.title)}`,
  ]
    .filter(Boolean)
    .join('&');
  return `/chat?${query}`;
}