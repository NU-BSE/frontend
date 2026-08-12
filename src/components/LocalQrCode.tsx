import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { toQR } from 'toqr';

interface LocalQrCodeProps {
  /** The content to encode. Never sent off-device. */
  value: string;
  /** Rendered size in dp (square). */
  size?: number;
  /** Quiet zone in modules, per the QR spec (default 4). */
  quietZone?: number;
  backgroundColor?: string;
  color?: string;
}

/**
 * Renders a QR code entirely on-device using the `toqr` encoder and
 * `react-native-svg`. No remote QR API is ever involved, so login tokens
 * (e.g. `tg://` links) never leave the device.
 */
export function LocalQrCode({
  value,
  size = 220,
  quietZone = 4,
  backgroundColor = '#FFFFFF',
  color = '#000000',
}: LocalQrCodeProps) {
  const matrix = useMemo(() => {
    try {
      const data = toQR(value);
      const dim = Math.sqrt(data.length);
      if (!Number.isInteger(dim) || dim === 0) return null;
      return { data, dim };
    } catch {
      return null;
    }
  }, [value]);

  if (!matrix) return null;

  const { data, dim } = matrix;
  const moduleSize = size / (dim + quietZone * 2);
  const offset = quietZone * moduleSize;

  const cells: React.ReactNode[] = [];
  for (let row = 0; row < dim; row += 1) {
    for (let col = 0; col < dim; col += 1) {
      if (data[row * dim + col]) {
        cells.push(
          <Rect
            key={`${row}-${col}`}
            x={offset + col * moduleSize}
            y={offset + row * moduleSize}
            width={moduleSize}
            height={moduleSize}
            fill={color}
          />,
        );
      }
    }
  }

  return (
    <View style={styles.wrap}>
      <Svg width={size} height={size}>
        <Rect width={size} height={size} fill={backgroundColor} />
        {cells}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'center',
    borderRadius: 8,
    overflow: 'hidden',
  },
});
