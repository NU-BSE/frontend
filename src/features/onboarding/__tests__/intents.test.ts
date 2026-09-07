import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  CUSTOM_INTENT_LABEL,
  CUSTOM_INTENT_PLACEHOLDER,
  intentsToScenarioIds,
  intentById,
  ONBOARDING_INTENTS,
} from '@/features/onboarding/intents';
import {
  getCustomIntent,
  getSelectedIntents,
  setCustomIntent,
  setSelectedIntents,
} from '@/storage/prefs';

describe('onboarding intents', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('3. offers the five interests in the specified order and copy', () => {
    expect(ONBOARDING_INTENTS.map((i) => i.id)).toEqual([
      'android_settings',
      'messages',
      'email',
      'calendar',
      'drive',
    ]);
    expect(intentById('android_settings')?.title).toBe('Android & Settings');
    expect(intentById('messages')?.description).toBe('Catch up and reply');
    expect(intentById('email')?.description).toBe('Find, summarize and draft');
    expect(intentById('calendar')?.description).toBe(
      'See your schedule and free time',
    );
    expect(intentById('drive')?.description).toBe(
      'Find files without remembering the name',
    );
  });

  it('4. custom intent has optional copy and is persisted', async () => {
    expect(CUSTOM_INTENT_LABEL).toBe('Something else');
    expect(CUSTOM_INTENT_PLACEHOLDER).toBe(
      'What do you wish your phone could just do for you?',
    );

    await setCustomIntent('Make my phone less distracting');
    expect(await getCustomIntent()).toBe('Make my phone less distracting');

    await setCustomIntent(null);
    expect(await getCustomIntent()).toBeNull();
  });

  it('maps intents to their scenario ids, including Android & Settings', () => {
    expect(
      intentsToScenarioIds(['android_settings', 'messages', 'email', 'calendar', 'drive']),
    ).toEqual(['settings', 'messaging', 'email', 'calendar', 'drive']);
  });

  it('persists selected intents, dropping unknown ids', async () => {
    await setSelectedIntents(['messages', 'calendar']);
    expect(await getSelectedIntents()).toEqual(['messages', 'calendar']);
  });
});
