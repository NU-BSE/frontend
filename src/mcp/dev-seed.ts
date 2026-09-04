import type { ConnectionStore } from '@mobile-agent/connector-core';

/**
 * Cleanup for the development account fixtures this app used to seed.
 *
 * It wrote eleven connections marked `connected` with no credentials behind
 * any of them, so a fresh install showed Google as signed in before the user
 * had done anything — and because tools follow the connection record, all
 * sixteen Google tools sat in the planner's prompt, ready to be called against
 * an account that did not exist. Eight of the eleven named connectors this
 * branch no longer registers, leaving records claiming accounts nothing could
 * serve.
 *
 * The seeding is gone. What remains is the list of ids it wrote, so a device
 * already carrying them is cleaned on its next launch. Removing this file
 * would strand those records on every phone that ever ran the old build, so it
 * stays until that is no longer a concern.
 */
const SEEDED_CONNECTION_IDS = [
  'google-default',
  'telegram-bot-default',
  'telegram-user-default',
  'microsoft-default',
  'slack-default',
  'notion-default',
  'todoist-default',
  'github-default',
  'dropbox-default',
  'discord-default',
  'spotify-default',
  /** A mock intent connection from an earlier build. */
  'intent-default',
] as const;

/**
 * Removes the development fixtures from the store.
 *
 * Safe to run unconditionally and on every launch: only these fixed ids are
 * removed, and a real connection never carries one of them — they are minted
 * by the connectors themselves (`android-device`, `telegram-user`, and the
 * ids returned by an OAuth flow).
 */
export async function removeDevelopmentConnections(
  store: ConnectionStore,
): Promise<void> {
  for (const id of SEEDED_CONNECTION_IDS) {
    await store.remove(id);
  }
}
