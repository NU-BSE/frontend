import { NativeModules, Platform } from 'react-native';

/**
 * Media transport and volume.
 *
 * Everything here goes through MediaSession, so it is the same request the
 * playing app's own notification makes — no UI automation, and it works for
 * whichever app holds the session rather than for a list of apps anticipated
 * in advance.
 *
 * Seeing sessions requires notification-listener access, which the app already
 * asks for to read the shade. Without it there are no sessions to command and
 * every call reports nothing playing.
 */

export interface NowPlaying {
  packageName: string;
  isPlaying: boolean;
  title?: string;
  artist?: string;
  album?: string;
}

type NativeMedia = {
  getNowPlaying(): Promise<NowPlaying | null>;
  play(): Promise<boolean>;
  pause(): Promise<boolean>;
  next(): Promise<boolean>;
  previous(): Promise<boolean>;
  stop(): Promise<boolean>;
  seekTo(positionMs: number): Promise<boolean>;
  getVolume(): Promise<number | null>;
  setVolume(fraction: number): Promise<boolean>;
};

const native = (NativeModules.MediaControl as NativeMedia | undefined) ?? null;

export function isSupported(): boolean {
  return Platform.OS === 'android' && native != null;
}

/** What is playing, or null when nothing is. */
export async function getNowPlaying(): Promise<NowPlaying | null> {
  if (!isSupported()) return null;
  try {
    return await native!.getNowPlaying();
  } catch {
    return null;
  }
}

/*
 * Every transport command resolves false when there is no session to command.
 * "Nothing is playing" is a normal answer to "skip this track", and a caller
 * should say so rather than report a failure.
 */
export async function play(): Promise<boolean> {
  return isSupported() ? native!.play() : false;
}
export async function pause(): Promise<boolean> {
  return isSupported() ? native!.pause() : false;
}
export async function next(): Promise<boolean> {
  return isSupported() ? native!.next() : false;
}
export async function previous(): Promise<boolean> {
  return isSupported() ? native!.previous() : false;
}
export async function stop(): Promise<boolean> {
  return isSupported() ? native!.stop() : false;
}
export async function seekTo(positionMs: number): Promise<boolean> {
  return isSupported() ? native!.seekTo(positionMs) : false;
}

/** Media volume as 0..1, or null when it cannot be read. */
export async function getVolume(): Promise<number | null> {
  if (!isSupported()) return null;
  try {
    return await native!.getVolume();
  } catch {
    return null;
  }
}

/**
 * Sets media volume.
 *
 * Rejects when Do Not Disturb is blocking volume changes — a real and common
 * state on a phone in a meeting, which the caller should explain rather than
 * appear to have done nothing.
 */
export async function setVolume(fraction: number): Promise<boolean> {
  if (!isSupported()) return false;
  return native!.setVolume(fraction);
}
