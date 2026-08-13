import React from 'react';
import { Text as RNText, type TextProps } from 'react-native';

import { palette, typography, type TypographyVariant } from '@/theme/tokens';

type Tone =
  | 'primary'
  | 'secondary'
  | 'muted'
  | 'faint'
  | 'brand'
  | 'gold'
  | 'inverse'
  | 'danger';

const TONE_COLOR: Record<Tone, string> = {
  primary: palette.textPrimary,
  secondary: palette.textSecondary,
  muted: palette.textMuted,
  faint: palette.textFaint,
  brand: palette.brand,
  gold: palette.gold,
  inverse: palette.onBrand,
  danger: palette.danger,
};

export interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  tone?: Tone;
  uppercase?: boolean;
}

/**
 * The only text primitive in the app.
 *
 * Font family comes from the variant, never from `fontWeight` — Android has
 * no synthetic bolding, so a weight that was not loaded silently renders as
 * regular. Routing every string through here makes that impossible.
 */
export function Text({
  variant = 'body',
  tone = 'primary',
  uppercase = false,
  style,
  children,
  ...rest
}: AppTextProps) {
  return (
    <RNText
      {...rest}
      style={[
        { includeFontPadding: false },
        typography[variant],
        { color: TONE_COLOR[tone] },
        uppercase && { textTransform: 'uppercase' as const },
        style,
      ]}
    >
      {children}
    </RNText>
  );
}
