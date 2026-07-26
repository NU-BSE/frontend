import React from 'react';
import type { ColorValue } from 'react-native';
import type { SvgProps } from 'react-native-svg';

export interface IconProps {
  source: React.FC<SvgProps>;
  size: number;
  /** Height, when the glyph is not square. Figma exports several that are not. */
  height?: number;
  /**
   * Accepts `ColorValue` rather than `string` because React Navigation hands
   * tab icons an opaque platform colour, not a hex.
   */
  color: ColorValue;
}

/**
 * Renders a Figma-exported SVG at an explicit size.
 *
 * The exports carry their own intrinsic width/height and were rewritten to
 * `fill="currentColor"`. Both dimensions are set explicitly rather than
 * relying on the parent to constrain them, so a non-square glyph keeps its
 * designed aspect ratio instead of being squashed to a square box.
 */
export function Icon({ source: Source, size, height, color }: IconProps) {
  return (
    <Source width={size} height={height ?? size} color={color as string} />
  );
}
