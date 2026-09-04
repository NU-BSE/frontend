import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { SubscriptionRequiredError } from '@/ai/modelInstall';
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
            label={state.progress ? 'Resume download' : 'Download'}
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
