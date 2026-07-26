import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type ViewStyle,
} from 'react-native';

import { Text } from './Text';
import { MIN_TOUCH_TARGET, palette, radius, shadow, spacing } from '@/theme/tokens';

type Variant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: Variant;
  loading?: boolean;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  /** Uppercase + tracked, matching the onboarding nav buttons. */
  overline?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  variant = 'primary',
  loading = false,
  leading,
  trailing,
  overline = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = Boolean(disabled) || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        VARIANT_STYLE[variant],
        pressed && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? palette.white : palette.brand}
        />
      ) : (
        <View style={styles.content}>
          {leading}
          <Text
            variant={overline ? 'labelSmall' : 'button'}
            tone={variant === 'primary' ? 'inverse' : 'secondary'}
            uppercase={overline}
            style={overline ? styles.overline : undefined}
          >
            {label}
          </Text>
          {trailing}
        </View>
      )}
    </Pressable>
  );
}

const VARIANT_STYLE: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: palette.brand, ...shadow.raised },
  secondary: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    ...shadow.card,
  },
  ghost: { backgroundColor: 'transparent' },
};

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  overline: { letterSpacing: 1.4 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
});
