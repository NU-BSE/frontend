import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Onboarding analytics.
 *
 * There is no third-party analytics SDK in this app, and none is added here:
 * events are recorded in a capped on-device log and offered to a pluggable
 * transport (a future backend endpoint) without ever blocking the UI.
 *
 * Privacy contract: only machine-readable ids are ever attached — selected
 * intent ids, provider names, AI mode, suggestion ids, tool names, feedback
 * result and alternative ids. Never chat prompts, Telegram/Gmail contents,
 * file names, or free-text custdev responses.
 */
export type OnboardingAnalyticsEvent =
  | 'onboarding_started'
  | 'onboarding_welcome_completed'
  | 'onboarding_auth_completed'
  | 'onboarding_intent_selected'
  | 'onboarding_connections_viewed'
  | 'onboarding_connection_started'
  | 'onboarding_connection_completed'
  | 'onboarding_ai_mode_selected'
  | 'onboarding_first_task_viewed'
  | 'onboarding_first_task_started'
  | 'onboarding_first_task_completed'
  | 'onboarding_feedback_submitted'
  | 'onboarding_paywall_viewed'
  | 'onboarding_trial_started'
  | 'onboarding_subscription_started'
  | 'onboarding_completed';

export type AnalyticsProperties = Record<
  string,
  string | number | boolean | string[] | null | undefined
>;

export interface AnalyticsEvent {
  name: string;
  properties?: AnalyticsProperties;
  timestamp: number;
}

type AnalyticsTransport = (event: AnalyticsEvent) => void | Promise<void>;

const EVENT_LOG_KEY = 'creepyim.analytics.events.v1';
const MAX_STORED = 200;

let transport: AnalyticsTransport | null = null;

/**
 * Wire a delivery mechanism for events. A no-op by default until the backend
 * endpoint exists; the on-device log is the durable record regardless.
 */
export function setAnalyticsTransport(handler: AnalyticsTransport | null): void {
  transport = handler;
}

async function appendToLog(event: AnalyticsEvent): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(EVENT_LOG_KEY);
    const entries: AnalyticsEvent[] = raw ? JSON.parse(raw) : [];
    entries.push(event);
    if (entries.length > MAX_STORED) {
      entries.splice(0, entries.length - MAX_STORED);
    }
    await AsyncStorage.setItem(EVENT_LOG_KEY, JSON.stringify(entries));
  } catch {
    // Logging must never break the flow.
  }
}

export async function readAnalyticsLog(): Promise<AnalyticsEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(EVENT_LOG_KEY);
    return raw ? (JSON.parse(raw) as AnalyticsEvent[]) : [];
  } catch {
    return [];
  }
}

export function clearAnalyticsLog(): Promise<void> {
  return AsyncStorage.removeItem(EVENT_LOG_KEY);
}

export function track(
  name: OnboardingAnalyticsEvent,
  properties?: AnalyticsProperties,
): void {
  const event: AnalyticsEvent = { name, properties, timestamp: Date.now() };
  if (__DEV__) {
    console.log('[analytics]', name, properties ?? {});
  }
  void appendToLog(event);
  try {
    void transport?.(event);
  } catch {
    // Transport failures are never surfaced to the onboarding flow.
  }
}