/**
 * Google OAuth scopes for the local MCP runtime.
 *
 * Least privilege: only the read-only scopes the currently implemented
 * Calendar/Drive tools need. Write scopes (sending mail, deleting events,
 * uploading files) are not requested until those tools are wired to the real
 * API.
 *
 * `drive.readonly` (a restricted scope) is required for searching *and*
 * reading file contents — `drive.metadata.readonly` only covers metadata and
 * is insufficient for download. Google verification of the restricted scope is
 * required before production release.
 */

export const GOOGLE_CALENDAR_READONLY =
  'https://www.googleapis.com/auth/calendar.readonly';

export const GOOGLE_DRIVE_READONLY =
  'https://www.googleapis.com/auth/drive.readonly';

export const GOOGLE_GMAIL_READONLY =
  'https://www.googleapis.com/auth/gmail.readonly';

export const GOOGLE_GMAIL_COMPOSE =
  'https://www.googleapis.com/auth/gmail.compose';

export const GOOGLE_GMAIL_MODIFY =
  'https://www.googleapis.com/auth/gmail.modify';

/**
 * Scopes requested when the user first connects Google. Gmail scopes are
 * intentionally absent: they are restricted/sensitive, so they are requested
 * incrementally (via `GoogleConnector.authorizeAdditionalScopes`) the first
 * time a Gmail tool is actually needed, keeping initial consent minimal.
 */
export const GOOGLE_MCP_SCOPES = [
  'openid',
  'email',
  'profile',
  GOOGLE_CALENDAR_READONLY,
  GOOGLE_DRIVE_READONLY,
] as const;
