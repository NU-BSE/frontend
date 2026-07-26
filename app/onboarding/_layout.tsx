import React from 'react';
import { Stack } from 'expo-router';

import { palette } from '@/theme/tokens';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.canvas },
      }}
    />
  );
}
