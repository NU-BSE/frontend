import React, { useCallback, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { OnlangFlow, type FlowResult } from '@onlang/react-native';

import { palette, spacing } from '@/theme/tokens';

/**
 * The paywall as an Onlang flow, with the classic screen as its fallback: shown when no flow can
 * load (first launch offline, delivery down) and when the placement's kill switch is on.
 */
export function OnlangPaywall({ fallback, onDone }: { fallback: ReactNode; onDone: () => void }) {
  const finished = useCallback(
    (result: FlowResult) => {
      // Bought, restored or skipped: leave exactly as the classic screen does.
      if (result.outcome === 'purchased' || result.outcome === 'restored' || result.outcome === 'closed') onDone();
    },
    [onDone],
  );
  return (
    <OnlangFlow
      placement="paywall"
      style={styles.flow}
      onFinished={finished}
      renderFallback={() => fallback}
      renderLoading={() => (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.brand} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  flow: { flex: 1, paddingBottom: spacing.xl },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
