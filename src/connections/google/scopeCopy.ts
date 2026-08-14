import {
  GOOGLE_CALENDAR_READONLY,
  GOOGLE_DRIVE_READONLY,
  GOOGLE_MCP_SCOPES,
} from '@mobile-agent/connector-google';

/**
 * Plain-language descriptions of the OAuth scopes, for the consent screen.
 *
 * Derived from `GOOGLE_MCP_SCOPES` rather than written out separately, so a
 * scope added to the request cannot fail to appear here. An unrecognised scope
 * falls back to its raw URL: showing a URL is ugly, but silently omitting a
 * permission the app is about to request would be dishonest, and this screen
 * is the only place the user is told what they are granting.
 */

export interface ScopeDescription {
  scope: string;
  title: string;
  detail: string;
}

const DESCRIPTIONS: Record<string, { title: string; detail: string }> = {
  openid: {
    title: 'Confirm who you are',
    detail: 'Identifies the account you pick. Nothing is read from it.',
  },
  email: {
    title: 'Your email address',
    detail: 'Shown on the connection so you know which account is linked.',
  },
  profile: {
    title: 'Your name and picture',
    detail: 'Used only to label the connection.',
  },
  [GOOGLE_CALENDAR_READONLY]: {
    title: 'Read your calendar',
    detail: 'View events and their details. Creepy cannot create, edit or delete them.',
  },
  [GOOGLE_DRIVE_READONLY]: {
    title: 'Read your Drive files',
    detail: 'Search and open file contents. Creepy cannot upload, change or delete anything.',
  },
};

export const GOOGLE_SCOPE_DESCRIPTIONS: ScopeDescription[] =
  GOOGLE_MCP_SCOPES.map((scope) => {
    const known = DESCRIPTIONS[scope];
    return {
      scope,
      title: known?.title ?? scope,
      detail: known?.detail ?? 'Requested by this app.',
    };
  });

/**
 * The scopes whose absence changes what the app can do.
 *
 * Google lets a user grant some requested scopes and refuse others, and the
 * flow still succeeds. Identity scopes only label the connection, so losing
 * them is cosmetic; losing Calendar or Drive means the tools silently have
 * nothing to read, which is worth saying out loud.
 */
export const GOOGLE_FUNCTIONAL_SCOPES: { scope: string; label: string }[] = [
  { scope: GOOGLE_CALENDAR_READONLY, label: 'Calendar' },
  { scope: GOOGLE_DRIVE_READONLY, label: 'Drive' },
];

export function missingFunctionalScopes(granted: readonly string[]): string[] {
  const set = new Set(granted);
  return GOOGLE_FUNCTIONAL_SCOPES.filter(
    (entry) => !set.has(entry.scope),
  ).map((entry) => entry.label);
}
