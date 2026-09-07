/**
 * Post-first-task feedback (custdev).
 *
 * Purely declarative option sets and validation. The network call that
 * persists the answer lives in the API client; this module stays free of any
 * runtime dependency so the options and the payload shape are unit-testable.
 */

export type FeedbackResult = 'yes' | 'partly' | 'no';

export type AlternativeId =
  | 'google'
  | 'chatgpt_or_gemini'
  | 'android_settings'
  | 'manual_app_action'
  | 'ask_someone'
  | 'would_not_do'
  | 'other';

export interface FeedbackResultOption {
  id: FeedbackResult;
  label: string;
}

export interface AlternativeOption {
  id: AlternativeId;
  label: string;
}

export const FEEDBACK_RESULT_OPTIONS: FeedbackResultOption[] = [
  { id: 'yes', label: 'Yes' },
  { id: 'partly', label: 'Partly' },
  { id: 'no', label: 'No' },
];

export const ALTERNATIVE_OPTIONS: AlternativeOption[] = [
  { id: 'google', label: 'Search Google' },
  { id: 'chatgpt_or_gemini', label: 'Ask ChatGPT or Gemini' },
  { id: 'android_settings', label: 'Find it in Android Settings myself' },
  { id: 'manual_app_action', label: 'Open the app and do it myself' },
  { id: 'ask_someone', label: 'Ask someone' },
  { id: 'would_not_do', label: "Probably wouldn't do it" },
  { id: 'other', label: 'Other' },
];

export interface OnboardingFeedbackInput {
  result: FeedbackResult;
  /** Free text shown only when the result is Partly or No. Optional. */
  expectation?: string;
  alternative: AlternativeId | null;
  /** Free text shown only when the alternative is Other. Optional. */
  alternativeNote?: string;
}

/** Whether the expectation text is relevant for a given result. */
export function expectsExplanation(result: FeedbackResult): boolean {
  return result === 'partly' || result === 'no';
}

/** Whether the "Other" free-text field is relevant for a given alternative. */
export function isOtherAlternative(id: AlternativeId | null): boolean {
  return id === 'other';
}

/**
 * Build the wire payload sent to the backend. The values are machine-readable
 * ids plus the two optional free-text fields the user explicitly typed; no
 * chat content ever lands in this payload.
 */
export function buildFeedbackPayload(input: OnboardingFeedbackInput): {
  result: FeedbackResult;
  expectation?: string;
  alternative?: AlternativeId;
  alternative_note?: string;
} {
  const payload: {
    result: FeedbackResult;
    expectation?: string;
    alternative?: AlternativeId;
    alternative_note?: string;
  } = { result: input.result };
  if (expectsExplanation(input.result) && input.expectation?.trim()) {
    payload.expectation = input.expectation.trim();
  }
  if (input.alternative) {
    payload.alternative = input.alternative;
    if (
      isOtherAlternative(input.alternative) &&
      input.alternativeNote?.trim()
    ) {
      payload.alternative_note = input.alternativeNote.trim();
    }
  }
  return payload;
}