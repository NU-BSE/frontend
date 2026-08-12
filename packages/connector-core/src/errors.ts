export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_CONNECTED'
      | 'AUTH_REQUIRED'
      | 'PERMISSION_REQUIRED'
      | 'RATE_LIMITED'
      | 'NOT_FOUND'
      | 'VALIDATION_FAILED'
      | 'PROVIDER_ERROR'
      | 'UNSUPPORTED'
      | 'OUTCOME_UNKNOWN'
      | 'CANCELLED',
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export class RateLimitError extends Error {
  constructor(readonly retryAfterMs: number | null) {
    super('Rate limited');
    this.name = 'RateLimitError';
  }
}
