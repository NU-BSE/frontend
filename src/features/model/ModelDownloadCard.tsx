import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { SubscriptionRequiredError } from '@/ai/modelInstall';
import { useAi } from '@/ai/AiProvider';
import {
  getDeviceAssessment,
  getMemoryProfile,
  setMemoryProfile,
} from '@/storage/prefs';
import { canUseLocalProfile } from '@/ai/deviceModelSelection';
import { memoryProfileAfterInstallChange } from './memoryProfileForInstall';
import { useModelInstall } from './useModelInstall';
import { palette, radius, spacing, typography } from '@/theme/tokens';

/** GB with one decimal — the unit people judge a mobile download in. */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * The on-device model: what it costs, and how far the download has got.
 *
 * The weights are not in the APK deliberately — a gigabyte inside a Play
 * download is a gigabyte every user pays for, including the ones who choose
 * cloud inference and never run a local model. So this screen is where that
 * gigabyte is chosen, and the size is shown *before* the button, not after.
 *
 * The bar reports bytes actually written to disk rather than a spinner or an
 * estimate: the download is chunked precisely so that number exists, and on a
 * mobile connection a bar that has not moved for thirty seconds is the
 * difference between waiting and giving up.
 */
export function ModelDownloadCard({ profile }: { profile: string }) {
  const { state, start, stop, remove } = useModelInstall(profile);
  const { activateSelectedEngine } = useAi();

  /*
   * Restart the engine when the model arrives — and move the profile with it.
   *
   * The engine is chosen once, when the provider mounts, from what was on disk
   * then. Downloading a model after that changed nothing until the app was
   * killed and reopened — the user watched a download finish and kept talking
   * to the stub. Removing it has the same problem in reverse, which is why
   * this reacts to the phase rather than to the download's success.
   *
   * Re-activating was not enough on its own. This card is shown to someone on
   * cloud inference on purpose, because deciding whether to switch means
   * seeing the download size first — but `resolveEngine` returns remote for
   * `cloud` before it looks at the disk at all, so a cloud user could download
   * a gigabyte, watch it finish, and still be talking to the cloud. The
   * download was offered as the way to switch and did not switch anything.
   *
   * So the profile follows the weights. Downloading them is a deliberate act
   * with one purpose, and removing them leaves `on-device` pointing at nothing
   * — a profile that resolves to a degraded stub — so the reverse has to move
   * too.
   *
   * Only when the device can actually run it. Nothing about the download
   * checks the hardware (`downloadAllowed` is the subscription, not the
   * phone), so a device that failed the local gate would otherwise be switched
   * onto a profile that immediately degrades.
   */
  const lastPhase = useRef(state.phase);
  useEffect(() => {
    const previous = lastPhase.current;
    lastPhase.current = state.phase;
    if (previous === state.phase) return;
    if (state.phase !== 'installed' && previous !== 'installed') return;
    if (previous === 'checking') return;

    const arrived = state.phase === 'installed';

    void (async () => {
      const [memoryProfile, assessment] = await Promise.all([
        getMemoryProfile(),
        getDeviceAssessment(),
      ]);

      const next = memoryProfileAfterInstallChange({
        installed: arrived,
        current: memoryProfile,
        canRunLocally: canUseLocalProfile('on-device', assessment),
      });
      if (next !== memoryProfile) await setMemoryProfile(next);

      await activateSelectedEngine(next, assessment);
    })();
  }, [state.phase, activateSelectedEngine]);

  const percent = state.progress ? Math.round(state.progress.fraction * 100) : 0;

  const subtitle = useMemo(() => {
    if (state.phase === 'checking') return 'Checking…';
    if (state.phase === 'installed' && state.installed) {
      return `${formatBytes(state.installed.bytes)} on this device`;
    }
    if (state.phase === 'downloading' && state.progress) {
      return `${formatBytes(state.progress.receivedBytes)} of ${formatBytes(
        state.progress.totalBytes,
      )}`;
    }
    if (state.bundle) return `${formatBytes(state.bundle.totalBytes)} to download`;
    return 'Not downloaded';
  }, [state]);

  const needsSubscription =
    state.error instanceof SubscriptionRequiredError ||
    state.blocker.kind === 'subscription';

  /** The reason the button is dead, in words the user can act on. */
  const blocked = useMemo(() => {
    switch (state.blocker.kind) {
      case 'offline':
        // The transport's own message already names the host it could not
        // reach, which is the actionable part; prefixing it repeated the
        // sentence back at the user.
        return state.blocker.message;
      case 'nothing-published':
        return 'The server has no weights published for this profile yet.';
      case 'subscription':
        return 'A subscription is required to download the model.';
      default:
        return null;
    }
  }, [state.blocker]);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>On-device model</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        {state.phase === 'installed' ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>READY</Text>
          </View>
        ) : null}
      </View>

      {state.phase === 'downloading' ? (
        <View style={styles.progress}>
          <View style={styles.track}>
            {/*
              Width as a percentage of the track, so the fill needs no measured
              layout and cannot disagree with the number beside it.
            */}
            <View style={[styles.fill, { width: `${Math.max(percent, 1)}%` }]} />
          </View>
          <View style={styles.progressRow}>
            <Text style={styles.progressFile} numberOfLines={1}>
              {state.progress?.currentFile ?? ''}
            </Text>
            <Text style={styles.progressPercent}>{percent}%</Text>
          </View>
        </View>
      ) : null}

      {state.error ? (
        <Text style={styles.error}>
          {needsSubscription
            ? 'A subscription is required to download the model.'
            : state.error.message}
        </Text>
      ) : null}

      {state.phase === 'not-installed' || state.phase === 'failed' ? (
        <>
          {/*
            Say which of the three reasons applies. A disabled button that
            explains nothing is the worst outcome, because only one of these
            is the user's to fix.
          */}
          {blocked ? (
            <Text style={styles.blocker}>{blocked}</Text>
          ) : (
            <Text style={styles.note}>
              Runs entirely on this phone. Nothing you type reaches a server.
            </Text>
          )}
          <Button
            label={state.progress ? 'Resume' : 'Download'}
            onPress={start}
            disabled={state.blocker.kind !== 'none'}
          />
        </>
      ) : null}

      {state.phase === 'downloading' ? (
        <Button label="Stop" variant="secondary" onPress={stop} />
      ) : null}

      {state.phase === 'installed' ? (
        <Button label="Remove" variant="ghost" onPress={() => void remove()} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerText: { flex: 1, gap: spacing.xs },
  title: { ...typography.cardTitle, color: palette.textPrimary },
  subtitle: { ...typography.bodySmall, color: palette.textMuted },
  badge: {
    // Opaque rather than a wash: this sits on `surface`, and a translucent
    // fill over a card reads differently from the same fill over the canvas.
    backgroundColor: palette.brandChip,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  badgeText: { ...typography.labelSmall, color: palette.brand },
  progress: { gap: spacing.xs },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.neutralChip,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: palette.brand },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  progressFile: { ...typography.bodySmall, color: palette.textFaint, flex: 1 },
  progressPercent: { ...typography.labelSmall, color: palette.textSecondary },
  note: { ...typography.bodySmall, color: palette.textSecondary },
  blocker: { ...typography.bodySmall, color: palette.gold },
  error: { ...typography.bodySmall, color: palette.danger },
});
