import AsyncStorage from "@react-native-async-storage/async-storage";

import type { DeviceAssessment } from "@/attestation/client/deviceAssessment";
import type { ScenarioId } from "@/features/scenarios/registry";

const ONBOARDING_KEY = "creepyim.onboarding.completed.v1";
const USER_PROFILE_KEY = "creepyim.onboarding.user-profile.v1";
const PENDING_EMAIL_AUTH_KEY = "creepyim.auth.pending-email.v1";
const CATEGORIES_KEY = "creepyim.onboarding.categories.v1";
const MEMORY_KEY = "creepyim.onboarding.memory.v1";
const DEVICE_ASSESSMENT_KEY = "creepyim.onboarding.device-assessment.v1";
const WELCOME_KEY = "creepyim.onboarding.welcome.v1";
const INTENT_KEY = "creepyim.onboarding.intent.v1";
const SELECTED_INTENTS_KEY = "creepyim.onboarding.intents.v1";
const CUSTOM_INTENT_KEY = "creepyim.onboarding.custom-intent.v1";
const CONNECTIONS_DONE_KEY = "creepyim.onboarding.connections-done.v1";
const AI_MODE_KEY = "creepyim.onboarding.ai-mode.v1";
const FIRST_TASK_KEY = "creepyim.onboarding.first-task.v1";
const FEEDBACK_KEY = "creepyim.onboarding.feedback.v1";

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
    // Non-fatal.
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
      WELCOME_KEY,
      INTENT_KEY,
      SELECTED_INTENTS_KEY,
      CUSTOM_INTENT_KEY,
      CONNECTIONS_DONE_KEY,
      AI_MODE_KEY,
      FIRST_TASK_KEY,
      FEEDBACK_KEY,
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
    // Non-fatal.
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

/**
 * Onboarding v2 progress flags.
 *
 * Each step records its own "done" marker so onboarding can be resumed from
 * the correct screen after a restart, process death, OAuth redirect, network
 * error or local model download. Connections are optional, so `connections`
 * being "done" means the step was seen and either connected or skipped.
 */
export const ONBOARDING_INTENT_IDS = [
  "android_settings",
  "messages",
  "email",
  "calendar",
  "drive",
] as const;

export type OnboardingIntentId = (typeof ONBOARDING_INTENT_IDS)[number];

const readBool = async (key: string): Promise<boolean> => {
  try {
    return (await AsyncStorage.getItem(key)) === "true";
  } catch {
    return false;
  }
};

const writeBool = async (key: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(key, "true");
  } catch {
    // Non-fatal — the flag can be written again on the next step.
  }
};

export async function getWelcomeCompleted(): Promise<boolean> {
  return readBool(WELCOME_KEY);
}
export async function setWelcomeCompleted(): Promise<void> {
  return writeBool(WELCOME_KEY);
}

export async function getIntentCompleted(): Promise<boolean> {
  return readBool(INTENT_KEY);
}
export async function setIntentCompleted(): Promise<void> {
  return writeBool(INTENT_KEY);
}

export async function getSelectedIntents(): Promise<OnboardingIntentId[]> {
  try {
    const raw = await AsyncStorage.getItem(SELECTED_INTENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is OnboardingIntentId =>
      ONBOARDING_INTENT_IDS.includes(id as OnboardingIntentId),
    );
  } catch {
    return [];
  }
}

export async function setSelectedIntents(
  ids: OnboardingIntentId[],
): Promise<void> {
  try {
    await AsyncStorage.setItem(SELECTED_INTENTS_KEY, JSON.stringify(ids));
  } catch {
    // Non-fatal.
  }
}

export async function getCustomIntent(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(CUSTOM_INTENT_KEY);
  } catch {
    return null;
  }
}

export async function setCustomIntent(text: string | null): Promise<void> {
  try {
    if (text) {
      await AsyncStorage.setItem(CUSTOM_INTENT_KEY, text);
    } else {
      await AsyncStorage.removeItem(CUSTOM_INTENT_KEY);
    }
  } catch {
    // Non-fatal.
  }
}

export async function getConnectionsDone(): Promise<boolean> {
  return readBool(CONNECTIONS_DONE_KEY);
}
export async function setConnectionsDone(): Promise<void> {
  return writeBool(CONNECTIONS_DONE_KEY);
}

export async function getAiModeDone(): Promise<boolean> {
  return readBool(AI_MODE_KEY);
}
export async function setAiModeDone(): Promise<void> {
  return writeBool(AI_MODE_KEY);
}

export async function getFirstTaskDone(): Promise<boolean> {
  return readBool(FIRST_TASK_KEY);
}
export async function setFirstTaskDone(): Promise<void> {
  return writeBool(FIRST_TASK_KEY);
}

export async function getFeedbackDone(): Promise<boolean> {
  return readBool(FEEDBACK_KEY);
}
export async function setFeedbackDone(): Promise<void> {
  return writeBool(FEEDBACK_KEY);
}
