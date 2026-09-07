import {
  getAiModeDone,
  getConnectionsDone,
  getFeedbackDone,
  getFirstTaskDone,
  getIntentCompleted,
  getPendingEmailAuth,
  getWelcomeCompleted,
  hasCompletedOnboarding,
} from '@/storage/prefs';

/**
 * Onboarding v2 steps, in order.
 *
 * `auth` is not a persisted flag: it is the presence of a session. Everything
 * else maps one-to-one onto a progress flag in prefs, so the resolver below
 * can rebuild the exact position of a mid-flight user after any interruption.
 */
export type OnboardingStep =
  | 'welcome'
  | 'auth'
  | 'intent'
  | 'connections'
  | 'ai-mode'
  | 'try'
  | 'feedback'
  | 'subscription';

export interface OnboardingProgress {
  welcome: boolean;
  intent: boolean;
  connections: boolean;
  aiMode: boolean;
  firstTask: boolean;
  feedback: boolean;
}

export async function getOnboardingProgress(): Promise<OnboardingProgress> {
  const [welcome, intent, connections, aiMode, firstTask, feedback] =
    await Promise.all([
      getWelcomeCompleted(),
      getIntentCompleted(),
      getConnectionsDone(),
      getAiModeDone(),
      getFirstTaskDone(),
      getFeedbackDone(),
    ]);
  return { welcome, intent, connections, aiMode, firstTask, feedback };
}

/**
 * The first step a user still has to take, in reading order.
 */
export function resolveOnboardingStep(
  progress: OnboardingProgress,
  authenticated: boolean,
): OnboardingStep {
  if (!authenticated) {
    if (!progress.welcome) return 'welcome';
    return 'auth';
  }
  if (!progress.intent) return 'intent';
  if (!progress.connections) return 'connections';
  if (!progress.aiMode) return 'ai-mode';
  if (!progress.firstTask) return 'try';
  if (!progress.feedback) return 'feedback';
  return 'subscription';
}

export function routeForStep(step: OnboardingStep): string {
  switch (step) {
    case 'welcome':
      return '/onboarding/welcome';
    case 'auth':
      return '/onboarding';
    case 'intent':
      return '/onboarding/features';
    case 'connections':
      return '/onboarding/connections';
    case 'ai-mode':
      return '/onboarding/memory';
    case 'try':
      return '/onboarding/try';
    case 'feedback':
      return '/onboarding/feedback';
    case 'subscription':
      return '/onboarding/subscription';
  }
}

/**
 * Decide where a user should land when the app opens.
 *
 * Existing users who already finished onboarding go straight to the feed.
 * Everyone else resumes at the first incomplete step — a brand-new user lands
 * on Welcome, someone mid-verification returns to the code screen, and a user
 * who already ran their first task returns to Feedback rather than starting
 * over.
 */
export async function resolveNextOnboardingRoute(
  authenticated: boolean,
): Promise<string> {
  if (await hasCompletedOnboarding()) return '/(tabs)/feed';

  const progress = await getOnboardingProgress();
  const step = resolveOnboardingStep(progress, authenticated);

  // A user who requested a code but never verified it (app killed, network
  // error, OAuth redirect) returns to the code screen, not the form.
  if (!authenticated && step === 'auth') {
    const pending = await getPendingEmailAuth();
    if (pending?.purpose === 'registration') return '/onboarding/auth';
  }

  return routeForStep(step);
}