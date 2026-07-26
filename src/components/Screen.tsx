import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/theme/tokens';

export interface ScreenProps extends ViewProps {
  topInset?: boolean;
  bottomInset?: boolean;
}

/**
 * Root container for every screen. Owns the canvas colour and safe-area
 * insets; Android runs edge-to-edge by default in RN 0.86, so insets are
 * mandatory rather than cosmetic.
 */
export function Screen({
  topInset = true,
  bottomInset = false,
  style,
  ...rest
}: ScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      {...rest}
      style={[
        styles.root,
        topInset && { paddingTop: insets.top },
        bottomInset && { paddingBottom: insets.bottom },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.canvas },
});
