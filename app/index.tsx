import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { hasCompletedOnboarding } from '@/storage/prefs';
import { palette } from '@/theme/tokens';

/**
 * Entry gate.
 *
 * Reading the flag is async, so rendering a redirect before it resolves would
 * flash onboarding at returning users. This holds on a neutral splash until
 * the answer is known — which is why it renders nothing branded.
 */
export default function Index() {
  const { data, isPending } = useQuery({
    queryKey: ['onboarding-status'],
    queryFn: hasCompletedOnboarding,
    staleTime: Infinity,
  });

  if (isPending) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={palette.brand} />
      </View>
    );
  }

  return <Redirect href={data ? '/(tabs)/feed' : '/onboarding'} />;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.canvas,
  },
});
