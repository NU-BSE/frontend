import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Config from '../../../config/attestation.config';
import {
  getLastClassifierTrace,
  subscribeClassifierTrace,
} from './debugTrace';
import type { ClassifierTrace } from '@attestation/shared/wire';
import { palette } from '@/theme/tokens';

type Props = {
  trace?: ClassifierTrace | null;
};

export const AttestationDebugPanel = ({ trace }: Props) => {
  const [storedTrace, setStoredTrace] = useState<ClassifierTrace | null>(
    getLastClassifierTrace(),
  );

  useEffect(() => subscribeClassifierTrace(setStoredTrace), []);

  const visibleTrace = trace ?? storedTrace;

  if (!__DEV__ || !Config.attestationDebug || !visibleTrace) {
    return null;
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Attestation Trace</Text>
      <ScrollView style={styles.body}>
        <Text style={styles.code}>{JSON.stringify(visibleTrace, null, 2)}</Text>
      </ScrollView>
    </View>
  );
};

/*
 * The last three hardcoded colours in the app. They were light-theme greys,
 * so on the neo-green ground this panel rendered as near-invisible text inside
 * a near-invisible box. Re-theming is a token edit everywhere else; these were
 * the exception that proves it, and are no longer one.
 */
const styles = StyleSheet.create({
  panel: {
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: 260,
    padding: 12,
  },
  title: {
    color: palette.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  body: {
    maxHeight: 210,
  },
  code: {
    color: palette.textSecondary,
    fontFamily: 'Courier',
    fontSize: 12,
  },
});
