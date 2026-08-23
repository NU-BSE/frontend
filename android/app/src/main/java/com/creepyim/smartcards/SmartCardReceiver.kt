package com.creepyim.smartcards

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Handles a button press.
 *
 * The transition happens here and nowhere else: the next card arrives in the
 * intent, is posted under the same notification id, and Android animates the
 * replacement. React Native is never started — an Activity launch or a
 * headless task would add a cold start, and Doze can defer the latter
 * indefinitely, which is not acceptable for something the user just pressed.
 *
 * The app is told about the press only if it happens to be running. That is a
 * notification, not a dependency: the card's behaviour never waits on JS.
 */
class SmartCardReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != SmartCardNotification.ACTION_PRESS) return

        val actionId = intent.getStringExtra(SmartCardNotification.EXTRA_ACTION_ID)
        val nextJson = intent.getStringExtra(SmartCardNotification.EXTRA_NEXT_CARD)

        if (nextJson == null) {
            // A terminal action. Clearing the card is the honest end of the
            // chain: leaving the last state up would suggest there is more to
            // do.
            SmartCardNotification.dismiss(context, SmartCardNotification.NOTIFICATION_ID)
        } else {
            try {
                SmartCardNotification.show(context, SmartCard.parse(nextJson))
            } catch (error: Throwable) {
                // The chain was validated in JS before it was posted, so this
                // means the payload was corrupted in transit. Dismiss rather
                // than leave a card whose buttons now do nothing.
                Log.e(TAG, "unusable next card for action $actionId", error)
                SmartCardNotification.dismiss(context, SmartCardNotification.NOTIFICATION_ID)
            }
        }

        if (actionId != null) {
            SmartCardsModule.emitPress(actionId)
        }
    }

    private companion object {
        const val TAG = "SmartCards"
    }
}
