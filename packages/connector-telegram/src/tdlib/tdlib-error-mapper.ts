import { ConnectorError } from '@mobile-agent/connector-core';

const AUTH_REQUIRED_RE =
  /not authorized|unauthorized|AUTH_KEY_UNREGISTERED|401/iu;

const NETWORK_RE =
  /network|timeout|connection refused|ETIMEDOUT|ENETUNREACH|ECONNREFUSED/iu;

const RATE_LIMIT_RE =
  /FLOOD|too many requests|rate limit|429/iu;

const CHAT_NOT_FOUND_RE =
  /chat not found|CHAT_NOT_FOUND|404/iu;

const RETRY_AFTER_RE = /FLOOD_WAIT_(\d+)|retry after (\d+)/iu;

function extractRetryAfter(message: string): number | null {
  const match = RETRY_AFTER_RE.exec(message);
  if (!match) return null;
  const seconds = Number.parseInt(match[1] ?? match[2] ?? '', 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function formatRetryAfter(seconds: number): string {
  if (seconds < 60) return `~${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `~${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return `~${hours} hours`;
}

/**
 * Maps a raw TDLib error (string message or object with `message`)
 * into a typed `ConnectorError` suitable for the MCP/Agent layer.
 *
 * Native stack traces, raw TDLib error codes, local filesystem paths,
 * and auth secrets never leave this helper.
 */
export function mapTdlibError(error: unknown, _context: string): ConnectorError {
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
    const retryAfter = extractRetryAfter(message);
    const suffix =
      retryAfter != null ? ` Retry in ${formatRetryAfter(retryAfter)}.` : '';
    return new ConnectorError(
      `Telegram rate-limited this request.${suffix}`,
      'RATE_LIMITED',
      true,
    );
  }

  if (NETWORK_RE.test(message)) {
    return new ConnectorError(
      'Telegram network request failed. Please try again.',
      'PROVIDER_ERROR',
      true,
    );
  }

  if (CHAT_NOT_FOUND_RE.test(message)) {
    return new ConnectorError(
      'The requested chat was not found.',
      'VALIDATION_FAILED',
    );
  }

  return new ConnectorError(
    'Telegram request failed. Please try again.',
    'PROVIDER_ERROR',
  );
}
