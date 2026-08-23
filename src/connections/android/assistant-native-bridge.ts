import type {
  AndroidAssistantBridge,
  AssistantScreenContext,
  AssistantStatus,
} from '@mobile-agent/connector-android';

/**
 * Binds the assistant native module to the connector's bridge contract.
 *
 * Mirrors settings-native-bridge.ts: `react-native` is reached through a
 * guarded `require` so this file stays importable from the Node verification
 * scripts, where both requires throw and are caught.
 */

type NativeAssistantModule = {
  isRoleAvailable(): Promise<boolean>;
  isDefaultAssistant(): Promise<boolean>;
  isAssistantServiceReady(): Promise<boolean>;
  requestAssistantRole(): Promise<boolean>;
  openAssistantSettings(): Promise<boolean>;
  getAssistContext(): Promise<string | null>;
};

function resolveNativeModule(): NativeAssistantModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeModules, Platform } = require('react-native') as typeof import('react-native');
    if (Platform.OS !== 'android') return null;
    return (NativeModules.AssistantRole as NativeAssistantModule | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * The bridge, or null when this build has no assistant module.
 *
 * Null is the state for iOS, web, Node, and any Android build made before the
 * config plugin was added. The connector registers no assistant tools in that
 * case, so the model is never offered a capability that would fail.
 */
export function getAndroidAssistantBridge(): AndroidAssistantBridge | null {
  const native = resolveNativeModule();
  if (!native) return null;

  return {
    async getStatus(): Promise<AssistantStatus> {
      /*
       * Read together rather than lazily: the three answers are only
       * meaningful as a set. "Role held but service not ready" is a real,
       * transient state right after a grant, and a caller comparing values
       * fetched at different moments would see a combination that never
       * actually existed.
       */
      const [roleAvailable, isDefault, serviceReady] = await Promise.all([
        native.isRoleAvailable(),
        native.isDefaultAssistant(),
        native.isAssistantServiceReady(),
      ]);
      return { roleAvailable, isDefault, serviceReady };
    },

    requestRole: () => native.requestAssistantRole(),

    openSettings: () => native.openAssistantSettings(),

    async getScreenContext(): Promise<AssistantScreenContext | null> {
      const raw = await native.getAssistContext();
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as AssistantScreenContext;
        // A capture without nodes is unusable; treat it as no capture rather
        // than handing the model an empty screen it might describe as empty.
        return Array.isArray(parsed.nodes) ? parsed : null;
      } catch {
        return null;
      }
    },
  };
}
