/**
 * Gmail-specific error mapping. Reuses the shared Google transport mapping
 * (`mapGoogleError`) so a 401 (clear token + retry once), 403
 * insufficientPermissions, 403 rate limit, 404, 429 and 5xx all surface as
 * the same structured ConnectorError codes the rest of the runtime understands.
 *
 * The distinction that matters for Gmail tools is the user-facing message:
 * when a scope is missing or the grant is gone, the model must be told to ask
 * the user to re-authorize — never to retry blindly.
 */
import { ConnectorError } from '@mobile-agent/connector-core';

import { GoogleApiError, mapGoogleError } from '../google-api-client';

/** True when the failure means the Google grant is gone or needs consent. */
export function isGmailReauthError(error: unknown): boolean {
  if (error instanceof ConnectorError) {
    return error.code === 'AUTH_REQUIRED' || error.code === 'PERMISSION_REQUIRED';
  }
  if (error instanceof GoogleApiError) {
    return error.code === 'AUTH_REQUIRED' || error.code === 'PERMISSION_REQUIRED';
  }
  return false;
}

export function mapGmailError(error: unknown, context: string): ConnectorError {
  const mapped = mapGoogleError(error, context);

  if (mapped.code === 'AUTH_REQUIRED') {
    return new ConnectorError(
      `Google authorization for ${context} is no longer valid. Ask the user to reconnect Google.`,
      'AUTH_REQUIRED',
    );
  }

  if (mapped.code === 'PERMISSION_REQUIRED') {
    return new ConnectorError(
      `Gmail permission is required for this Google account. Ask the user to reconnect/authorize Gmail.`,
      'PERMISSION_REQUIRED',
    );
  }

  return mapped;
}
