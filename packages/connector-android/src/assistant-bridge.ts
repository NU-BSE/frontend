/**
 * The Android assistant role, as this package sees it.
 *
 * Declared here and implemented by the app layer, like AndroidSettingsBridge:
 * nothing in this package may import Expo or React Native, because the same
 * tools are exercised from Node verification scripts.
 */

export interface AssistantStatus {
  /** The device exposes ROLE_ASSISTANT (API 29+). */
  roleAvailable: boolean;
  /** Creepy currently holds the role. */
  isDefault: boolean;
  /**
   * The platform has bound the voice interaction service.
   *
   * Distinct from holding the role: the bind is asynchronous, so a freshly
   * granted role can be held while the service is not yet ready to be shown.
   */
  serviceReady: boolean;
}

export interface AssistantScreenNode {
  text?: string;
  hint?: string;
  contentDescription?: string;
  className?: string;
  webDomain?: string;
}

export interface AssistantScreenContext {
  packageName: string | null;
  activityName: string | null;
  title?: string;
  url?: string;
  nodes: AssistantScreenNode[];
  truncated: boolean;
  showSource: string;
}

export interface AndroidAssistantBridge {
  getStatus(): Promise<AssistantStatus>;

  /**
   * Show the system role dialog.
   *
   * Resolves true only when the role is held afterwards. A refusal resolves
   * false rather than throwing — the user declining is an answer.
   */
  requestRole(): Promise<boolean>;

  /** Open the system screen where the assistant is chosen. */
  openSettings(): Promise<boolean>;

  /** The screen captured by the last invocation, or null. */
  getScreenContext(): Promise<AssistantScreenContext | null>;
}
