import {
  buildFirstTaskChatUrl,
  buildFirstTaskSuggestions,
  type ConnectionLike,
} from '@/features/onboarding/suggestions';

const connected = (connectorId: string): ConnectionLike[] => [
  { connectorId, status: 'connected' },
];
const notConnected = (connectorId: string): ConnectionLike[] => [
  { connectorId, status: 'disconnected' },
];

describe('first-task suggestions', () => {
  it('12. Android suggestions come from the Android interest', () => {
    const result = buildFirstTaskSuggestions({
      intents: ['android_settings'],
      connections: [],
    });
    expect(result.map((s) => s.title)).toEqual([
      "Find what's draining my battery",
      'Help me find a setting',
      'Stop an app from bothering me with notifications',
    ]);
  });

  it('6. Telegram task appears only when Telegram is connected', () => {
    const wantsTelegram = { intents: ['messages'], connections: [] };
    const noTelegram = buildFirstTaskSuggestions(wantsTelegram);
    expect(noTelegram.some((s) => s.id === 'telegram_catchup')).toBe(false);

    const withTelegram = buildFirstTaskSuggestions({
      intents: ['messages'],
      connections: connected('telegram-user'),
    });
    expect(withTelegram.map((s) => s.id)).toContain('telegram_catchup');
  });

  it('7. Calendar/Drive tasks appear only when Google is connected', () => {
    const intents = ['calendar', 'drive'];
    expect(
      buildFirstTaskSuggestions({ intents, connections: [] }).map((s) => s.id),
    ).toEqual([]);
    expect(
      buildFirstTaskSuggestions({ intents, connections: notConnected('google') }).map(
        (s) => s.id,
      ),
    ).toEqual([]);

    const withGoogle = buildFirstTaskSuggestions({
      intents,
      connections: connected('google'),
    });
    expect(withGoogle.map((s) => s.id)).toEqual([
      'calendar_today',
      'drive_find_file',
    ]);
  });

  it('combines interests with connected integrations and caps at five', () => {
    const result = buildFirstTaskSuggestions({
      intents: ['android_settings', 'messages', 'calendar', 'drive'],
      connections: connected('google').concat(connected('telegram-user')),
    });
    expect(result.length).toBe(5);
    expect(result.map((s) => s.id)).toEqual([
      'android_battery',
      'android_setting',
      'android_notifications',
      'telegram_catchup',
      'calendar_today',
    ]);
  });

  it('returns nothing when no interest is selected', () => {
    expect(buildFirstTaskSuggestions({ intents: [], connections: [] })).toEqual(
      [],
    );
  });
});

describe('first-task chat URL', () => {
  it('13. opens the real chat with source=onboarding and the task as prompt', () => {
    expect(
      buildFirstTaskChatUrl({
        id: 'calendar_today',
        title: "What's on my calendar today?",
        scenarioId: 'calendar',
      }),
    ).toBe(
      "/chat?source=onboarding&task=calendar_today&scenario=calendar&prompt=What's%20on%20my%20calendar%20today%3F",
    );
  });

  it('omits the scenario for a custom request', () => {
    expect(
      buildFirstTaskChatUrl({ id: 'custom', title: 'Do a thing', scenarioId: null }),
    ).toBe('/chat?source=onboarding&task=custom&prompt=Do%20a%20thing');
  });
});
