import { ConnectorError } from '@mobile-agent/connector-core';

const AUTH_REQUIRED_RE =
  /not authorized|unauthorized|AUTH_KEY_UNREGISTERED|401/iu;

const NETWORK_RE =
  /network|timeout|connection refused|ETIMEDOUT|ENETUNREACH|ECONNREFUSED/iu;

const RATE_LIMIT_RE =
  /FLOOD_WAIT|too many requests|rate limit|429/iu;

const CHAT_NOT_FOUND_RE =
  /chat not found|CHAT_NOT_FOUND|404/iu;

/**
 * Maps a raw TDLib error (string message or object with `message`)
 * into a typed `ConnectorError` suitable for the MCP/Agent layer.
 *
 * Native stack traces and raw TDLib error codes never leave this helper.
 */
export function mapTdlibError(error: unknown, context: string): ConnectorError {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);

  if (AUTH_REQUIRED_RE.test(message)) {
    return new ConnectorError(
      'Telegram session is not authorized. Please reconnect.',
      'AUTH_REQUIRED',
    );
  }

  if (RATE_LIMIT_RE.test(message)) {
    return new ConnectorError(
      'Telegram rate-limited this request. Please wait and try again.',
      'PROVIDER_ERROR',
    );
  }

  if (NETWORK_RE.test(message)) {
    return new ConnectorError(
      `Telegram network error during ${context}: ${message.slice(0, 200)}`,
      'PROVIDER_ERROR',
    );
  }

  if (CHAT_NOT_FOUND_RE.test(message)) {
    return new ConnectorError(
      'The requested chat was not found.',
      'VALIDATION_FAILED',
    );
  }

  return new ConnectorError(
    `Telegram ${context} failed: ${message.slice(0, 200)}`,
    'PROVIDER_ERROR',
  );
}
