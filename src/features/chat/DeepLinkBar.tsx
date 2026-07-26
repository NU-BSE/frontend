import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import ArrowRight from '@assets/icons/arrow-right-blue.svg';
import { openDeepLink } from './deepLinks';
import type { DeepLink } from '@/features/scenarios/registry';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

/**
 * Hand-off into another app.
 *
 * Every link here is currently a stub. The buttons are still live rather
 * than disabled, because `openDeepLink` attempts the real scheme first — so
 * swapping in a working target needs no change here — and reports a specific
 * reason inline when it cannot open. A disabled button would teach the user
 * nothing and would need rewiring later.
 */
export function DeepLinkBar({ links }: { links: DeepLink[] }) {
  const [notice, setNotice] = useState<string | null>(null);

  const open = useCallback(async (link: DeepLink) => {
    setNotice(null);
    const outcome = await openDeepLink(link);
    if (outcome.status === 'unavailable') setNotice(outcome.reason);
  }, []);

  if (links.length === 0) return null;

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        {links.map((link) => (
          <Pressable
            key={link.url}
            accessibilityRole="link"
            accessibilityLabel={`Open in ${link.label}`}
            onPress={() => void open(link)}
            style={({ pressed }) => [styles.link, pressed && styles.pressed]}
          >
            <Text variant="labelSmall" tone="brand">
              {link.label}
            </Text>
            <Icon source={ArrowRight} size={11} color={palette.brand} />
          </Pressable>
        ))}
      </View>

      {notice ? (
        <Text variant="bodySmall" tone="muted" style={styles.notice}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: palette.brandWash,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadow.card,
  },
  notice: { paddingHorizontal: spacing.xs },
  pressed: { opacity: 0.75 },
});
