import { Platform } from 'react-native';

import NativeAssistant from '@/specs/NativeAssistant';

/**
 * Becoming the device assistant, and reading what was on screen when we were
 * summoned.
 *
 * Every call degrades to a "no" rather than throwing when the native module is
 * absent, which is the state on iOS, on web, and in any build made before the
 * config plugin was added. Callers gate on `isAvailable()` for UI and can
 * otherwise treat the results as truthful.
 */

/** One node from the screen the user was looking at. */
export interface ScreenNode {
  text?: string;
  hint?: string;
  contentDescription?: string;
  className?: string;
  webDomain?: string;
  bounds?: { left: number; top: number; right: number; bottom: number };
}

/** How the assistant came to be invoked. */
export type AssistSource =
  | 'assist_gesture'
  | 'push_to_talk'
  | 'notification'
  | 'activity'
  | 'application'
  | 'automotive'
  | 'unknown';

export interface ScreenContext {
  packageName: string | null;
  activityName: string | null;
  title?: string;
  /** Published by the app itself when it chooses to; better than scraped text. */
  url?: string;
  structuredData?: string;
  nodes: ScreenNode[];
  /** The node budget was exhausted, so this is a partial view of the screen. */
  truncated: boolean;
  showSource: AssistSource;
}

export function isAvailable(): boolean {
  return Platform.OS === 'android' && NativeAssistant != null;
}

export async function isRoleAvailable(): Promise<boolean> {
  if (!isAvailable()) return false;
  return NativeAssistant!.isRoleAvailable();
}

export async function isDefaultAssistant(): Promise<boolean> {
  if (!isAvailable()) return false;
  return NativeAssistant!.isDefaultAssistant();
}

export async function isServiceReady(): Promise<boolean> {
  if (!isAvailable()) return false;
  return NativeAssistant!.isAssistantServiceReady();
}

/**
 * Ask to become the device assistant.
 *
 * Below API 29 there is no role dialog to show, so the native side opens the
 * assist settings screen and this resolves false; the caller should re-check
 * `isDefaultAssistant()` when the app next returns to the foreground rather
 * than treating that false as a refusal.
 */
export async function requestAssistantRole(): Promise<boolean> {
  if (!isAvailable()) return false;
  return NativeAssistant!.requestAssistantRole();
}

export async function openAssistantSettings(): Promise<boolean> {
  if (!isAvailable()) return false;
  return NativeAssistant!.openAssistantSettings();
}

/**
 * The screen captured by the most recent invocation, or null.
 *
 * Malformed JSON resolves to null rather than throwing: this value crosses the
 * bridge as a string built natively, and a parse failure means the capture is
 * unusable, which is the same situation as having none.
 */
export async function getScreenContext(): Promise<ScreenContext | null> {
  if (!isAvailable()) return null;
  const raw = await NativeAssistant!.getAssistContext();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ScreenContext;
    return Array.isArray(parsed.nodes) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearScreenContext(): void {
  if (!isAvailable()) return;
  NativeAssistant!.clearAssistContext();
}

/**
 * Renders a screen context as prompt text.
 *
 * Nodes are emitted one per line and the app is named first, because the model
 * needs to know *which* app it is looking at before the text means anything —
 * "Send" in a mail client and "Send" in a banking app are not the same button.
 * Bounds are omitted: they are large, and nothing downstream can act on a
 * coordinate now that UI automation is out of scope.
 */
export function serializeScreenContext(context: ScreenContext): string {
  const header = [
    `app: ${context.packageName ?? 'unknown'}`,
    context.activityName ? `screen: ${context.activityName}` : null,
    context.title ? `title: ${context.title}` : null,
    context.url ? `url: ${context.url}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const node of context.nodes) {
    // The same label often appears on a view and its content description.
    const line = node.text ?? node.contentDescription ?? node.hint;
    if (!line) continue;
    const trimmed = line.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    lines.push(trimmed);
  }

  const body = lines.join('\n');
  const note = context.truncated
    ? '\n\n(the screen was longer than this; content was cut off)'
    : '';
  return `${header}\n\ncontent:\n${body}${note}`;
}
