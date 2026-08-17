import { TurboModuleRegistry, type TurboModule } from 'react-native';

/**
 * Android notification cards, driven from JavaScript.
 *
 * A Turbo Native Module because none of this exists in JS: notification
 * channels, heads-up importance, RemoteViews and PendingIntent are platform
 * APIs, and the card has to keep working after the JS runtime is gone.
 *
 * ## Why the card is a JSON string
 *
 * A card carries follow-up cards — pressing an action replaces the
 * notification with the next state, which has its own actions, which have
 * their own next states. Codegen's type language cannot express a recursive
 * shape, and flattening it into a state table would put the graph's integrity
 * beyond the type system anyway. So the graph crosses the bridge as JSON and
 * is validated on both sides: `smartCards.ts` builds it from typed objects,
 * and Kotlin refuses anything it cannot parse rather than showing half a card.
 *
 * ## Why the whole graph is sent up front
 *
 * The transitions run entirely in the receiver: no JS is started, no Activity
 * is launched, nothing waits on a headless task that Doze may never schedule.
 * That is only possible if the next state is already on the device when the
 * user taps, so it travels inside the PendingIntent that the tap fires.
 */
export interface Spec extends TurboModule {
  /** Create the notification channel. Idempotent; safe to call on every start. */
  createChannel(): void;

  /** Whether notifications may currently be posted. */
  hasPermission(): Promise<boolean>;

  /**
   * Ask for POST_NOTIFICATIONS (Android 13+).
   *
   * Resolves true when already granted or granted by the user, false when
   * denied. Below API 33 there is no runtime permission and it resolves to
   * whether notifications are enabled for the app at all.
   */
  requestPermission(): Promise<boolean>;

  /** Post (or replace) a card. `cardJson` is a serialized SmartCard. */
  showCard(cardJson: string): Promise<void>;

  /** Remove a posted card by its notification id. */
  dismiss(notificationId: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('SmartCards');
