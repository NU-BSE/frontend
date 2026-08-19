/**
 * Which Play category an MCP server's app belongs to.
 *
 * The predictor is trained on Play categories, and the agent's logs name
 * concrete packages, so something has to join them. Kept as data rather than
 * scattered conditionals: a new connector adds a line here and needs no change
 * anywhere in the notification path.
 *
 * Categories use the trainer's normalization (upper snake case), so these
 * strings index the frozen bundle directly.
 */

export interface AppCategory {
  /** Android package, as it appears in the agent's tool logs. */
  packageName: string;
  /** Play category, normalized the way the trainer normalizes it. */
  category: string;
  /** What to call it in a notification. */
  label: string;
}

export const APP_CATEGORIES: AppCategory[] = [
  { packageName: 'org.telegram.messenger', category: 'COMMUNICATION', label: 'Telegram' },
  { packageName: 'com.google.android.gm', category: 'COMMUNICATION', label: 'Gmail' },
  { packageName: 'com.Slack', category: 'COMMUNICATION', label: 'Slack' },
  { packageName: 'com.whatsapp', category: 'COMMUNICATION', label: 'WhatsApp' },
  { packageName: 'com.discord', category: 'COMMUNICATION', label: 'Discord' },
  { packageName: 'com.google.android.apps.docs', category: 'PRODUCTIVITY', label: 'Drive' },
  { packageName: 'com.google.android.apps.docs.editors.docs', category: 'PRODUCTIVITY', label: 'Docs' },
  { packageName: 'com.google.android.calendar', category: 'PRODUCTIVITY', label: 'Calendar' },
  { packageName: 'com.microsoft.office.outlook', category: 'PRODUCTIVITY', label: 'Outlook' },
  { packageName: 'com.todoist', category: 'PRODUCTIVITY', label: 'Todoist' },
  { packageName: 'notion.id', category: 'PRODUCTIVITY', label: 'Notion' },
  { packageName: 'com.dropbox.android', category: 'PRODUCTIVITY', label: 'Dropbox' },
  { packageName: 'com.github.android', category: 'PRODUCTIVITY', label: 'GitHub' },
  { packageName: 'com.spotify.music', category: 'MUSIC_AND_AUDIO', label: 'Spotify' },
];

const BY_PACKAGE = new Map(APP_CATEGORIES.map((entry) => [entry.packageName, entry]));

export function categoryFor(packageName: string): AppCategory | undefined {
  return BY_PACKAGE.get(packageName);
}

/** Every package known to belong to a category. */
export function packagesIn(category: string): AppCategory[] {
  return APP_CATEGORIES.filter((entry) => entry.category === category);
}

/** The distinct categories, in first-seen order. */
export function knownCategories(): string[] {
  return [...new Set(APP_CATEGORIES.map((entry) => entry.category))];
}
