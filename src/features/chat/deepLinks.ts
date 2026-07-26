import { Linking } from 'react-native';

import type { DeepLink } from '@/features/scenarios/registry';

export type DeepLinkOutcome =
  | { status: 'opened'; target: string }
  | { status: 'unavailable'; reason: string };

/**
 * Open a scenario deep link, degrading honestly.
 *
 * The links in the registry are stubs. Rather than hiding that behind a
 * disabled button, this tries the real scheme first — so the day a real
 * target is swapped in it simply works — and reports a specific reason when
 * it cannot. `canOpenURL` is authoritative on Android only for schemes
 * declared in the manifest's `queries`, so a `false` result is treated as
 * "probably not installed" rather than proof, and the open is still
 * attempted before giving up.
 */
export async function openDeepLink(link: DeepLink): Promise<DeepLinkOutcome> {
  const candidates: string[] = [link.url];
  if (link.webUrl) candidates.push(link.webUrl);

  for (const target of candidates) {
    try {
      await Linking.openURL(target);
      return { status: 'opened', target };
    } catch {
      // Try the next candidate — a failed scheme is expected for stubs.
    }
  }

  return {
    status: 'unavailable',
    reason: link.webUrl
      ? `${link.label} is not installed, and the web fallback did not open.`
      : `${link.label} is not wired up yet — this link is still a stub.`,
  };
}
