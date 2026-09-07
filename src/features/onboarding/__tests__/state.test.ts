import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getOnboardingProgress,
  resolveNextOnboardingRoute,
  resolveOnboardingStep,
  routeForStep,
} from '@/features/onboarding/state';
import {
  setAiModeDone,
  setConnectionsDone,
  setFeedbackDone,
  setFirstTaskDone,
  setIntentCompleted,
  setOnboardingComplete,
  setPendingEmailAuth,
  setWelcomeCompleted,
} from '@/storage/prefs';

const emptyProgress = {
  welcome: false,
  intent: false,
  connections: false,
  aiMode: false,
  firstTask: false,
  feedback: false,
};

describe('onboarding state / resume', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('1. a new user starts at Welcome', async () => {
    expect(resolveOnboardingStep(emptyProgress, false)).toBe('welcome');
    expect(await resolveNextOnboardingRoute(false)).toBe('/onboarding/welcome');
  });

  it('2. an authenticated user skips auth and lands on the intent step', async () => {
    await setWelcomeCompleted();
    const progress = await getOnboardingProgress();
    expect(resolveOnboardingStep(progress, true)).toBe('intent');
    expect(await resolveNextOnboardingRoute(true)).toBe('/onboarding/features');
  });

  it('5. Connections are skippable; skipping advances to AI mode', async () => {
    const beforeConnections = {
      ...emptyProgress,
      welcome: true,
      intent: true,
      connections: false,
    };
    expect(resolveOnboardingStep(beforeConnections, true)).toBe('connections');
    expect(
      resolveOnboardingStep({ ...beforeConnections, connections: true }, true),
    ).toBe('ai-mode');
  });

  it('22. an app restart resumes the correct incomplete step', async () => {
    // Mid-flow: everything before the first task is done.
    await setWelcomeCompleted();
    await setIntentCompleted();
    await setConnectionsDone();
    await setAiModeDone();
    expect(await resolveNextOnboardingRoute(true)).toBe('/onboarding/try');

    // First task completed, feedback not → resume to Feedback.
    await setFirstTaskDone();
    expect(await resolveNextOnboardingRoute(true)).toBe('/onboarding/feedback');

    // Feedback done → resume to Subscription (which finishes to the feed).
    await setFeedbackDone();
    expect(await resolveNextOnboardingRoute(true)).toBe('/onboarding/subscription');
  });

  it('22b. a user mid-verification resumes at the code screen', async () => {
    await setWelcomeCompleted();
    await setPendingEmailAuth({
      challengeId: 'challenge',
      email: 'a@b.c',
      purpose: 'registration',
    });
    expect(await resolveNextOnboardingRoute(false)).toBe('/onboarding/auth');
  });

  it('23. an existing user never sees v2 onboarding again', async () => {
    await setOnboardingComplete();
    expect(await resolveNextOnboardingRoute(true)).toBe('/(tabs)/feed');
    expect(await resolveNextOnboardingRoute(false)).toBe('/(tabs)/feed');
  });

  it('maps every step to its route', () => {
    expect(routeForStep('welcome')).toBe('/onboarding/welcome');
    expect(routeForStep('auth')).toBe('/onboarding');
    expect(routeForStep('intent')).toBe('/onboarding/features');
    expect(routeForStep('connections')).toBe('/onboarding/connections');
    expect(routeForStep('ai-mode')).toBe('/onboarding/memory');
    expect(routeForStep('try')).toBe('/onboarding/try');
    expect(routeForStep('feedback')).toBe('/onboarding/feedback');
    expect(routeForStep('subscription')).toBe('/onboarding/subscription');
  });
});
