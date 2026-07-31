import AsyncStorage from "@react-native-async-storage/async-storage";

import type { DeviceAssessment } from "@/attestation/client/deviceAssessment";
import type { ScenarioId } from "@/features/scenarios/registry";

const ONBOARDING_KEY = "creepyim.onboarding.completed.v1";
const USER_PROFILE_KEY = "creepyim.onboarding.user-profile.v1";
const PENDING_EMAIL_AUTH_KEY = "creepyim.auth.pending-email.v1";
const CATEGORIES_KEY = "creepyim.onboarding.categories.v1";
const MEMORY_KEY = "creepyim.onboarding.memory.v1";
const DEVICE_ASSESSMENT_KEY = "creepyim.onboarding.device-assessment.v1";

export type MemoryProfile = "efficient" | "balanced" | "performance" | "cloud";

export type UserProfile = {
  name: string;
  email: string;
};

export type PendingEmailAuth = {
  challengeId: string;
  email: string;
  name?: string;
  purpose: "registration" | "login";
};

export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function setOnboardingComplete(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_KEY, "true");
  } catch {
    // Worst case the user sees onboarding once more.
  }
}

export async function resetOnboarding(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      ONBOARDING_KEY,
      USER_PROFILE_KEY,
      PENDING_EMAIL_AUTH_KEY,
      CATEGORIES_KEY,
      MEMORY_KEY,
      DEVICE_ASSESSMENT_KEY,
    ]);
  } catch {
    // Non-fatal.
  }
}

export async function getPendingEmailAuth(): Promise<PendingEmailAuth | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_EMAIL_AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingEmailAuth>;
    const purposeIsValid =
      parsed.purpose === "registration" || parsed.purpose === "login";
    return typeof parsed.challengeId === "string" &&
      typeof parsed.email === "string" &&
      purposeIsValid
      ? (parsed as PendingEmailAuth)
      : null;
  } catch {
    return null;
  }
}

export async function setPendingEmailAuth(
  pending: PendingEmailAuth,
): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_EMAIL_AUTH_KEY, JSON.stringify(pending));
  } catch {
    // The code screen will ask the user to request a new code.
  }
}

export async function clearPendingEmailAuth(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_EMAIL_AUTH_KEY);
  } catch {
    // Non-fatal.
  }
}

export async function getUserProfile(): Promise<UserProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    return typeof parsed.name === "string" && typeof parsed.email === "string"
      ? { name: parsed.name, email: parsed.email }
      : null;
  } catch {
    return null;
  }
}

export async function setUserProfile(profile: UserProfile): Promise<void> {
  try {
    await AsyncStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Non-fatal — the profile can be collected again later.
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

export async function setSelectedCategories(ids: ScenarioId[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(ids));
  } catch {
    // Non-fatal — the app works without a category preference.
  }
}

export async function getMemoryProfile(): Promise<MemoryProfile> {
  try {
    const raw = await AsyncStorage.getItem(MEMORY_KEY);
    return raw === "efficient" ||
      raw === "balanced" ||
      raw === "performance" ||
      raw === "cloud"
      ? raw
      : "efficient";
  } catch {
    return "efficient";
  }
}

export async function setMemoryProfile(profile: MemoryProfile): Promise<void> {
  try {
    await AsyncStorage.setItem(MEMORY_KEY, profile);
  } catch {
    // Non-fatal.
  }
}

export async function getDeviceAssessment(): Promise<DeviceAssessment | null> {
  try {
    const raw = await AsyncStorage.getItem(DEVICE_ASSESSMENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DeviceAssessment>;
    return parsed.schemaVersion === 1 && typeof parsed.platform === "string"
      ? (parsed as DeviceAssessment)
      : null;
  } catch {
    return null;
  }
}

export async function setDeviceAssessment(
  assessment: DeviceAssessment,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      DEVICE_ASSESSMENT_KEY,
      JSON.stringify(assessment),
    );
  } catch {
    // The model selection screen will safely fall back to cloud-only.
  }
}
