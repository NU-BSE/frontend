import { NativeEventEmitter, Platform } from 'react-native';

import NativeSmartCards from '@/specs/NativeSmartCards';

/**
 * Contextual notification cards.
 *
 * A card is a heads-up notification with action buttons. Pressing one replaces
 * the same notification with the next card, so a prompt can become a detail
 * and then a confirmation without the app ever coming to the foreground.
 *
 *   "Have you read recent messages?"   [Check Telegram]
 *        ↓ press
 *   "Anya · 7PM · photos from work"    [Send confirmation]
 *        ↓ press
 *   "Sent."
 *
 * The whole chain is declared here and handed to Android in one call. The
 * transitions then run in a BroadcastReceiver: no JS, no Activity, and nothing
 * that Doze can defer. The cost is that a card cannot decide its next state
 * from data it does not already have — anything dynamic has to be fetched
 * before the card is posted, not after the tap.
 */

export interface SmartCardAction {
  /** Reported back to JS when the app is running. Not shown to the user. */
  id: string;
  /** Button label. Android shows at most three actions. */
  label: string;
  /**
   * The card that replaces this one when the action is pressed.
   *
   * Omit for a terminal action, which dismisses the notification instead.
   */
  next?: SmartCard;
}

export interface SmartCard {
  /** Headline, bold in both the collapsed and expanded card. */
  title: string;
  /** Body. The expanded card wraps it; the collapsed one truncates. */
  text: string;
  /** Optional third line, expanded card only — a timestamp, a sender, a hint. */
  detail?: string;
  actions?: SmartCardAction[];
  /**
   * Whether pressing the notification body (not an action) dismisses it.
   * Defaults to false: a card mid-chain should survive a stray tap.
   */
  autoCancel?: boolean;
}

/**
 * One id, one card stack.
 *
 * Replacing a notification means calling notify() with the id it already has —
 * that is what makes Android animate the change in place instead of stacking a
 * second card. Every state in a chain therefore shares this id.
 */
export const SMART_CARD_NOTIFICATION_ID = 4242;

/** Android shows three action buttons and silently drops the rest. */
const MAX_ACTIONS = 3;

/**
 * Action ids the app assigns meaning to.
 *
 * Shared constants rather than strings written at both ends: the press event
 * carries only this id, so a typo on either side would silently produce a
 * button that does nothing.
 */
export const APPROVE_ACTION_ID = 'approval:confirm';
export const REJECT_ACTION_ID = 'approval:reject';

/** Emitted by the native module when a card button is pressed. */
const PRESS_EVENT = 'SmartCards.press';

/**
 * Listen for card presses.
 *
 * Only delivered while the JS runtime is alive. That is not a gap for
 * approvals — an approval belongs to an agent run held in memory, so if the
 * process is gone there is nothing left to approve.
 *
 * Returns an unsubscribe function.
 */
export function onCardPress(listener: (actionId: string) => void): () => void {
  if (!isAvailable()) return () => {};

  const emitter = new NativeEventEmitter(
    NativeSmartCards as ConstructorParameters<typeof NativeEventEmitter>[0],
  );
  const subscription = emitter.addListener(PRESS_EVENT, (actionId: string) => {
    listener(actionId);
  });
  return () => subscription.remove();
}

/**
 * Whether notification cards can be used at all.
 *
 * False on iOS and web, and false on Android when the build has no native
 * module — either it predates the config plugin being registered in app.json,
 * or it is a dev client that never included it.
 * Everything below is a no-op in that state rather than an error: cards are an
 * enhancement, and an approval is always answerable in the app itself.
 */
export function isAvailable(): boolean {
  return isAndroid() && NativeSmartCards != null;
}

export class SmartCardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmartCardError';
  }
}

const isAndroid = (): boolean => Platform.OS === 'android';

function validate(card: SmartCard, path = 'card'): void {
  if (!card.title.trim()) {
    throw new SmartCardError(`${path}.title is empty; a card with no headline is not worth posting.`);
  }
  const actions = card.actions ?? [];
  if (actions.length > MAX_ACTIONS) {
    // Truncating silently would ship a button the user can never reach.
    throw new SmartCardError(
      `${path} has ${actions.length} actions; Android shows at most ${MAX_ACTIONS}.`,
    );
  }
  const ids = new Set<string>();
  actions.forEach((action, index) => {
    if (!action.id.trim()) {
      throw new SmartCardError(`${path}.actions[${index}].id is empty.`);
    }
    if (ids.has(action.id)) {
      // Duplicate ids would collide as PendingIntent request codes, and the
      // second button would silently fire the first one's intent.
      throw new SmartCardError(`${path} repeats the action id "${action.id}".`);
    }
    ids.add(action.id);
    if (action.next) validate(action.next, `${path}.actions[${index}].next`);
  });
}

/** Whether notifications can be posted right now. */
export async function hasPermission(): Promise<boolean> {
  if (!isAvailable()) return false;
  return NativeSmartCards!.hasPermission();
}

/**
 * Ask for notification permission.
 *
 * Android 13+ only shows the dialog once per install; after a denial this
 * resolves false without prompting, so the caller must not treat a false as
 * "ask again".
 */
export async function requestPermission(): Promise<boolean> {
  if (!isAvailable()) return false;
  return NativeSmartCards!.requestPermission();
}

/**
 * Post a card, or replace the one already showing.
 *
 * Validates the whole chain first: a malformed follow-up state would otherwise
 * only surface when the user pressed the button that reveals it.
 */
export async function showCard(card: SmartCard): Promise<void> {
  if (!isAvailable()) return;
  validate(card);
  NativeSmartCards!.createChannel();
  await NativeSmartCards!.showCard(JSON.stringify(card));
}

/** Remove the card. */
export function dismiss(notificationId = SMART_CARD_NOTIFICATION_ID): void {
  if (!isAvailable()) return;
  NativeSmartCards!.dismiss(notificationId);
}
