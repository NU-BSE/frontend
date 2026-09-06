import type { MemoryProfile } from '@/storage/prefs';

/**
 * Where the memory profile should land when the weights arrive or leave.
 *
 * `resolveEngine` returns remote for `cloud` before it looks at the disk at
 * all, so the stored profile — not the download — decides which engine runs.
 * The download card is shown to someone on cloud inference on purpose, because
 * deciding whether to switch means seeing the size first, and it was offered
 * as the way to switch while switching nothing: a cloud user could download a
 * gigabyte, watch it finish, and go on talking to the cloud.
 *
 * So the profile follows the weights, in both directions. Downloading them is
 * a deliberate act with one purpose. Removing them leaves `on-device` pointing
 * at nothing, which resolves to a degraded stub, so that has to move back.
 *
 * Two things are deliberately left alone:
 *
 *  - A device that cannot run the model. Nothing about the download checks the
 *    hardware — `downloadAllowed` is the subscription, not the phone — so
 *    without this a phone that failed the local gate would be switched onto a
 *    profile that immediately degrades.
 *  - A profile that is already where it is going. Returning the same value
 *    lets the caller skip the write.
 */
export function memoryProfileAfterInstallChange(input: {
  /** True when the model has just finished installing, false when removed. */
  installed: boolean;
  current: MemoryProfile;
  /** Whether this device passes the local-execution gate. */
  canRunLocally: boolean;
}): MemoryProfile {
  if (input.installed) {
    if (input.current !== 'cloud') return input.current;
    return input.canRunLocally ? 'on-device' : 'cloud';
  }
  // The weights are gone, so `on-device` has nothing to point at and `cloud`
  // is already right. Both land in the same place.
  return 'cloud';
}
