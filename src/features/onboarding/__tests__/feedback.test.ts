import {
  ALTERNATIVE_OPTIONS,
  buildFeedbackPayload,
  expectsExplanation,
  FEEDBACK_RESULT_OPTIONS,
  isOtherAlternative,
} from '@/features/onboarding/feedback';

describe('onboarding feedback', () => {
  it('17. Yes is a valid result and needs no explanation', () => {
    expect(FEEDBACK_RESULT_OPTIONS.map((o) => o.id)).toEqual([
      'yes',
      'partly',
      'no',
    ]);
    expect(expectsExplanation('yes')).toBe(false);
  });

  it('18. Partly and 19. No ask for an expectation, and it is optional', () => {
    expect(expectsExplanation('partly')).toBe(true);
    expect(expectsExplanation('no')).toBe(true);

    const withExpectation = buildFeedbackPayload({
      result: 'no',
      expectation: 'I wanted it to open the setting directly',
      alternative: 'manual_app_action',
    });
    expect(withExpectation.expectation).toBe(
      'I wanted it to open the setting directly',
    );

    const withoutExpectation = buildFeedbackPayload({
      result: 'partly',
      expectation: '',
      alternative: null,
    });
    expect(withoutExpectation.expectation).toBeUndefined();
    expect(withoutExpectation.alternative).toBeUndefined();
  });

  it('lists the seven alternatives with the specified values', () => {
    expect(ALTERNATIVE_OPTIONS.map((o) => o.id)).toEqual([
      'google',
      'chatgpt_or_gemini',
      'android_settings',
      'manual_app_action',
      'ask_someone',
      'would_not_do',
      'other',
    ]);
  });

  it('adds a note only for the Other alternative', () => {
    expect(isOtherAlternative('other')).toBe(true);
    expect(isOtherAlternative('google')).toBe(false);

    const payload = buildFeedbackPayload({
      result: 'yes',
      alternative: 'other',
      alternativeNote: 'I would have asked my friend',
    });
    expect(payload.alternative).toBe('other');
    expect(payload.alternative_note).toBe('I would have asked my friend');
  });
});
