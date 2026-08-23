import { NativeModules, Platform } from 'react-native';

/**
 * Text to speech.
 *
 * `speak` resolves when the utterance finishes, so an assistant turn can be
 * awaited rather than guessed at with a timer. Each call flushes the queue:
 * two answers spoken over each other is never wanted, and a backlog means the
 * user hears a reply to something they have already moved past.
 */

export interface Voice {
  name: string;
  language: string;
  /** The voice is synthesised server-side and will not work offline. */
  networkRequired: boolean;
}

type NativeTts = {
  isAvailable(): Promise<boolean>;
  speak(text: string): Promise<void>;
  stop(): void;
  setRate(rate: number): void;
  setPitch(pitch: number): void;
  setLanguage(tag: string): Promise<boolean>;
  getVoices(): Promise<Voice[]>;
};

const native = (NativeModules.CreepyTextToSpeech as NativeTts | undefined) ?? null;

export function isSupported(): boolean {
  return Platform.OS === 'android' && native != null;
}

export async function isAvailable(): Promise<boolean> {
  if (!isSupported()) return false;
  return native!.isAvailable();
}

/**
 * Speak, resolving when the utterance finishes or is stopped.
 *
 * A no-op off Android rather than a throw: speech is an enhancement to a
 * conversation that also works silently, so a caller should not have to branch
 * on platform to say something.
 */
export async function speak(text: string): Promise<void> {
  if (!isSupported()) return;
  return native!.speak(text);
}

/** Stop immediately. Any awaited `speak` resolves rather than rejecting. */
export function stop(): void {
  if (!isSupported()) return;
  native!.stop();
}

/** 1.0 is the engine's normal speed. The platform clamps the extremes. */
export function setRate(rate: number): void {
  if (!isSupported()) return;
  native!.setRate(rate);
}

export function setPitch(pitch: number): void {
  if (!isSupported()) return;
  native!.setPitch(pitch);
}

/**
 * Choose a language by BCP-47 tag.
 *
 * Resolves false when the engine has no voice for it, so a caller can fall
 * back or stay silent instead of having a Russian reply read out in English.
 */
export async function setLanguage(tag: string): Promise<boolean> {
  if (!isSupported()) return false;
  return native!.setLanguage(tag);
}

export async function getVoices(): Promise<Voice[]> {
  if (!isSupported()) return [];
  return native!.getVoices();
}
