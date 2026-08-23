import { NativeModules } from 'react-native';

/**
 * The Android assistant role and the screen context it captures.
 *
 * ## Why NativeModules and not TurboModuleRegistry
 *
 * This project has no `codegenConfig`, so nothing under src/specs/ is fed to
 * codegen and no native spec class is generated from it. The Kotlin side is a
 * plain ReactContextBaseJavaModule behind a ReactPackage, and under the New
 * Architecture those reach the TurboModuleManager only when
 * `useTurboModuleInterop` is enabled — which defaults to false. A
 * `getEnforcing` lookup here would therefore throw on every build, including
 * correct ones. NativeSmartCards learned this by crashing the app at startup.
 */
export interface Spec {
  /** Whether this device exposes ROLE_ASSISTANT at all (API 29+). */
  isRoleAvailable(): Promise<boolean>;

  /** Whether Creepy is the device's selected assistant right now. */
  isDefaultAssistant(): Promise<boolean>;

  /**
   * Ask the user to make Creepy the assistant.
   *
   * Resolves true only when the role is held afterwards. A refusal resolves
   * false — declining is an answer, not a failure. Rejects only when the
   * request could not be put to the user at all.
   */
  requestAssistantRole(): Promise<boolean>;

  /** Open the system screen where the assistant app is chosen. */
  openAssistantSettings(): Promise<boolean>;

  /**
   * JSON for the screen captured by the most recent invocation, or null.
   *
   * Null is ordinary: the assistant may not have been invoked, the user may
   * have turned off sending screen content to the assistant, or the capture
   * may have aged out. Reading it consumes nothing, but a stale capture is
   * discarded rather than returned.
   */
  getAssistContext(): Promise<string | null>;

  clearAssistContext(): void;

  /**
   * Whether the platform has bound the voice interaction service.
   *
   * Distinct from holding the role: the bind happens asynchronously after the
   * grant, so a freshly granted role can be held while the service is not yet
   * ready.
   */
  isAssistantServiceReady(): Promise<boolean>;
}

/** Null when the native module is absent — an older build, iOS, or web. */
const NativeAssistant = (NativeModules.AssistantRole as Spec | undefined) ?? null;

export default NativeAssistant;
