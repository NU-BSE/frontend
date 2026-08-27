import { NativeModules, Platform } from 'react-native';

/**
 * The notification shade.
 *
 * Notification access is granted on a system screen, like usage access, so
 * this exposes state plus a way to open the screen rather than a request that
 * resolves to a decision.
 *
 * Access being granted and the listener being bound are different states. The
 * platform binds asynchronously after a grant, so a caller that reads the
 * shade immediately after the user returns from settings can legitimately see
 * nothing; `isConnected` distinguishes "not yet listening" from "nothing to
 * report".
 */

export interface DeviceNotification {
  /** Platform key. Stable while the notification is posted, not after. */
  key: string;
  packageName: string;
  title?: string;
  text?: string;
  /** Unix milliseconds. */
  postedAt: number;
  /** The notification carries a free-form reply action. */
  canReply: boolean;
}

type NativeReader = {
  hasPermission(): Promise<boolean>;
  isConnected(): Promise<boolean>;
  openSettings(): Promise<boolean>;
  getNotifications(): Promise<DeviceNotification[]>;
  reply(key: string, message: string): Promise<boolean>;
};

const native = (NativeModules.NotificationReader as NativeReader | undefined) ?? null;

export function isSupported(): boolean {
  return Platform.OS === 'android' && native != null;
}

export async function hasPermission(): Promise<boolean> {
  if (!isSupported()) return false;
  return native!.hasPermission();
}

export async function isConnected(): Promise<boolean> {
  if (!isSupported()) return false;
  return native!.isConnected();
}

export async function openSettings(): Promise<boolean> {
  if (!isSupported()) return false;
  return native!.openSettings();
}

/** The recent shade, newest first. Empty when access has not been granted. */
export async function getNotifications(): Promise<DeviceNotification[]> {
  if (!isSupported()) return [];
  try {
    return await native!.getNotifications();
  } catch {
    return [];
  }
}

/**
 * Replies through a notification's own reply action.
 *
 * Resolves false when the notification is gone or never offered a reply — both
 * ordinary. A conversation the user has already opened elsewhere has no reply
 * action left, and there is no way to synthesise one.
 *
 * This sends a message to another person. It is a side effect the user must
 * approve; the caller is responsible for that, not this function.
 */
export async function reply(key: string, message: string): Promise<boolean> {
  if (!isSupported()) return false;
  return native!.reply(key, message);
}
