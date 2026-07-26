import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ScenarioId } from '@/features/scenarios/registry';

const ONBOARDING_KEY = 'creepyim.onboarding.completed.v1';
const CATEGORIES_KEY = 'creepyim.onboarding.categories.v1';
const MEMORY_KEY = 'creepyim.onboarding.memory.v1';

/** Matches the four rows in the Memory Config frame. */
export type MemoryProfile = 'efficient' | 'balanced' | 'performance' | 'cloud';

/**
 * Preferences, not secrets, so AsyncStorage is correct. Auth tokens belong
 * in expo-secure-store instead — see src/auth/providers.ts.
 *
 * Every read swallows its error and returns a safe default: a storage
 * failure should never lock a user out of the app.
 */
export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function setOnboardingComplete(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
  } catch {
    // Worst case the user sees onboarding once more.
  }
}

export async function resetOnboarding(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([ONBOARDING_KEY, CATEGORIES_KEY, MEMORY_KEY]);
  } catch {
    // Non-fatal.
  }
}

export async function getSelectedCategories(): Promise<ScenarioId[]> {
  try {
    const raw = await AsyncStorage.getItem(CATEGORIES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ScenarioId[]) : [];
  } catch {
    return [];
  }
}

export async function setSelectedCategories(
  ids: ScenarioId[],
): Promise<void> {
  try {
    await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(ids));
  } catch {
    // Non-fatal — the app works without a category preference.
  }
}

export async function getMemoryProfile(): Promise<MemoryProfile> {
  try {
    const raw = await AsyncStorage.getItem(MEMORY_KEY);
    return raw === 'efficient' ||
      raw === 'balanced' ||
      raw === 'performance' ||
      raw === 'cloud'
      ? raw
      : 'efficient';
  } catch {
    return 'efficient';
  }
}

export async function setMemoryProfile(profile: MemoryProfile): Promise<void> {
  try {
    await AsyncStorage.setItem(MEMORY_KEY, profile);
  } catch {
    // Non-fatal.
  }
}
