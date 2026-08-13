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

export const GOOGLE_MCP_SCOPES = [
  'openid',
  'email',
  'profile',
  GOOGLE_CALENDAR_READONLY,
  GOOGLE_DRIVE_READONLY,
] as const;
