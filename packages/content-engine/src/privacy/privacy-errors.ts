/**
 * Privacy enforcement errors. These fire when the routing/seam layer would
 * otherwise move private content off the device or put a credential into a
 * prompt.
 */
export type PrivacyErrorCode =
  | 'PRIVACY_BOUNDARY_VIOLATION'
  | 'LOCAL_MODEL_REQUIRED'
  | 'CREDENTIAL_IN_PROMPT';

export class PrivacyError extends Error {
  constructor(
    readonly code: PrivacyErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PrivacyError';
  }
}
