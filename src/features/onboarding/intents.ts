import type { ScenarioId } from '@/features/scenarios/registry';
import type { OnboardingIntentId } from '@/storage/prefs';

/**
 * The interests a new user can pick on the intent screen.
 *
 * An interest is a *user* preference, not an integration grant. Android &
 * Settings is offered even though the Settings connector is always present —
 * the user saying "help me with my phone" is what personalizes the feed and
 * the first-task suggestions, and it has nothing to do with whether the
 * Settings connector is technically available.
 */
export interface OnboardingIntent {
  id: OnboardingIntentId;
  title: string;
  description: string;
  /** The scenario this interest drives once onboarding is over. */
  scenarioId: ScenarioId;
}

export const ONBOARDING_INTENTS: OnboardingIntent[] = [
  {
    id: 'android_settings',
    title: 'Android & Settings',
    description: 'Fix problems and change phone settings',
    scenarioId: 'settings',
  },
  {
    id: 'messages',
    title: 'Messages',
    description: 'Catch up and reply',
    scenarioId: 'messaging',
  },
  {
    id: 'email',
    title: 'Email',
    description: 'Find, summarize and draft',
    scenarioId: 'email',
  },
  {
    id: 'calendar',
    title: 'Calendar',
    description: 'See your schedule and free time',
    scenarioId: 'calendar',
  },
  {
    id: 'drive',
    title: 'Files & Drive',
    description: 'Find files without remembering the name',
    scenarioId: 'drive',
  },
];

/** The "Something else" affordance below the grid. */
export const CUSTOM_INTENT_LABEL = 'Something else';
export const CUSTOM_INTENT_PLACEHOLDER =
  'What do you wish your phone could just do for you?';

export function intentById(
  id: OnboardingIntentId,
): OnboardingIntent | undefined {
  return ONBOARDING_INTENTS.find((intent) => intent.id === id);
}

export function scenarioForIntent(id: OnboardingIntentId): ScenarioId {
  return intentById(id)?.scenarioId ?? 'settings';
}

export function intentsToScenarioIds(
  ids: OnboardingIntentId[],
): ScenarioId[] {
  return ids.map(scenarioForIntent);
}