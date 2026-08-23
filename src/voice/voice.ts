import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

/**
 * Speech to text.
 *
 * One utterance per `startListening`, ending in exactly one `result` or one
 * `error` — that is the platform recogniser's shape, and pretending otherwise
 * would mean inventing a stream that does not exist. Continuous conversation
 * is built by restarting after each result, not by holding the mic open.
 *
 * No audio crosses the bridge; only transcripts do.
 */

export interface Transcript {
  transcript: string;
  alternatives: string[];
  isFinal: boolean;
}

export type VoiceErrorCode =
  | 'AUDIO'
  | 'CLIENT'
  | 'PERMISSION'
  | 'NETWORK'
  | 'NETWORK_TIMEOUT'
  | 'NO_MATCH'
  | 'BUSY'
  | 'SERVER'
  | 'SPEECH_TIMEOUT'
  | 'UNKNOWN';

export interface VoiceError {
  code: VoiceErrorCode;
  message: string;
}

/**
 * Codes that mean "the user did not say anything", not "the recogniser broke".
 *
 * Worth naming, because the platform reports both through the same callback
 * and a caller that shows an error banner for silence is annoying to use.
 */
export const SILENCE_CODES: readonly VoiceErrorCode[] = ['NO_MATCH', 'SPEECH_TIMEOUT'];

export function isSilence(error: VoiceError): boolean {
  return SILENCE_CODES.includes(error.code);
}

type NativeSpeech = {
  isAvailable(): Promise<boolean>;
  isOnDeviceRecognitionAvailable(): Promise<boolean>;
  hasPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  startListening(language: string | null, preferOffline: boolean): Promise<void>;
  stopListening(): void;
  cancel(): void;
  destroy(): void;
};

const native = (NativeModules.SpeechRecognition as NativeSpeech | undefined) ?? null;

export function isSupported(): boolean {
  return Platform.OS === 'android' && native != null;
}

export async function isAvailable(): Promise<boolean> {
  if (!isSupported()) return false;
  return native!.isAvailable();
}

/** Whether transcription can happen without a network round trip. */
export async function isOnDeviceRecognitionAvailable(): Promise<boolean> {
  if (!isSupported()) return false;
  return native!.isOnDeviceRecognitionAvailable();
}

export async function hasPermission(): Promise<boolean> {
  if (!isSupported()) return false;
  return native!.hasPermission();
}

export async function requestPermission(): Promise<boolean> {
  if (!isSupported()) return false;
  return native!.requestPermission();
}

export interface ListenOptions {
  /** BCP-47 tag. Omitted means the device's own recognition language. */
  language?: string;
  /**
   * Ask for on-device recognition.
   *
   * A request, not a guarantee — the platform silently falls back to network
   * recognition when it has no local model for the language.
   */
  preferOffline?: boolean;
}

export async function startListening(options: ListenOptions = {}): Promise<void> {
  if (!isSupported()) {
    throw new Error('Speech recognition is not available in this build.');
  }
  return native!.startListening(options.language ?? null, options.preferOffline ?? false);
}

/** Stop capturing and transcribe what was heard. */
export function stopListening(): void {
  if (!isSupported()) return;
  native!.stopListening();
}

/** Abandon the utterance. No result is emitted. */
export function cancel(): void {
  if (!isSupported()) return;
  native!.cancel();
}

export function destroy(): void {
  if (!isSupported()) return;
  native!.destroy();
}

export interface VoiceListeners {
  onReady?: () => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onPartial?: (transcript: Transcript) => void;
  onResult?: (transcript: Transcript) => void;
  onError?: (error: VoiceError) => void;
}

/**
 * Subscribe to recognition events. Returns an unsubscribe function.
 *
 * All handlers are optional, and every subscription is removed together —
 * leaving one attached after a screen unmounts would deliver a transcript to a
 * closed conversation.
 */
export function addListeners(listeners: VoiceListeners): () => void {
  if (!isSupported()) return () => {};

  const emitter = new NativeEventEmitter(
    native as unknown as ConstructorParameters<typeof NativeEventEmitter>[0],
  );

  const subscriptions = [
    listeners.onReady && emitter.addListener('Voice.ready', listeners.onReady),
    listeners.onSpeechStart &&
      emitter.addListener('Voice.speechStart', listeners.onSpeechStart),
    listeners.onSpeechEnd && emitter.addListener('Voice.speechEnd', listeners.onSpeechEnd),
    listeners.onPartial && emitter.addListener('Voice.partial', listeners.onPartial),
    listeners.onResult && emitter.addListener('Voice.result', listeners.onResult),
    listeners.onError && emitter.addListener('Voice.error', listeners.onError),
  ].filter(Boolean) as { remove: () => void }[];

  return () => subscriptions.forEach((subscription) => subscription.remove());
}
