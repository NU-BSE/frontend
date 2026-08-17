package com.creepyim.smartcards

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/*
 * The layouts compile into the app module, so their ids live in the app's R
 * class, not this package's. The application id is only known at prebuild
 * time, so the plugin rewrites this line — see plugins/with-smart-cards.js.
 * Resolving ids by name with getIdentifier() would avoid the rewrite and give
 * up every compile-time check on the layouts in exchange.
 */
import __APP_PACKAGE__.R

/**
 * Builds and posts the card.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 * 1. Every state of a chain is posted with the SAME notification id. That is
 *    what makes Android replace the card in place and animate the change,
 *    rather than stacking a second notification. A new id per state would look
 *    like a pile of alerts.
 *
 * 2. Each action gets its own PendingIntent request code. With a shared code,
 *    FLAG_UPDATE_CURRENT makes the last-built intent overwrite the earlier
 *    ones, and every button silently fires the same action.
 */
object SmartCardNotification {
    const val CHANNEL_ID = "smart_actions"
    const val NOTIFICATION_ID = 4242

    const val EXTRA_ACTION_ID = "com.creepyim.smartcards.ACTION_ID"
    const val EXTRA_NEXT_CARD = "com.creepyim.smartcards.NEXT_CARD"
    const val ACTION_PRESS = "com.creepyim.smartcards.PRESS"

    /**
     * IMPORTANCE_HIGH is what earns a heads-up card. Anything lower and the
     * notification only appears in the shade, which defeats the point.
     *
     * The channel's importance is fixed at creation: Android ignores later
     * changes, and the user's own adjustment always wins after that.
     */
    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "Smart actions",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Contextual suggestions you can act on from the notification."
            enableVibration(true)
            setShowBadge(true)
        }
        context.getSystemService(NotificationManager::class.java)
            ?.createNotificationChannel(channel)
    }

    fun show(context: Context, card: SmartCard) {
        createChannel(context)
        NotificationManagerCompat.from(context)
            .notify(NOTIFICATION_ID, build(context, card))
    }

    fun dismiss(context: Context, notificationId: Int) {
        NotificationManagerCompat.from(context).cancel(notificationId)
    }

    private fun build(context: Context, card: SmartCard): android.app.Notification {
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(context.applicationInfo.icon)
            .setContentTitle(card.title)
            .setContentText(card.text)
            // PRIORITY_HIGH is the pre-Oreo half of the heads-up request; the
            // channel covers Oreo and later. Both are needed to span versions.
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .setAutoCancel(card.autoCancel)
            .setOnlyAlertOnce(true)
            .setCustomContentView(compactView(context, card))
            .setCustomBigContentView(expandedView(context, card))
            // Keeps the system chrome — app name, timestamp, expand chevron —
            // around our RemoteViews instead of leaving a bare rectangle.
            .setStyle(NotificationCompat.DecoratedCustomViewStyle())

        card.actions.forEachIndexed { index, action ->
            builder.addAction(0, action.label, pendingIntentFor(context, action, index))
        }
        return builder.build()
    }

    /**
     * The intent a button fires.
     *
     * The next card rides along as an extra, so the receiver needs no stored
     * state and the chain survives the process being killed between the card
     * being posted and the user pressing it.
     */
    private fun pendingIntentFor(
        context: Context,
        action: SmartCardAction,
        index: Int,
    ): PendingIntent {
        val intent = Intent(context, SmartCardReceiver::class.java).apply {
            this.action = ACTION_PRESS
            putExtra(EXTRA_ACTION_ID, action.id)
            action.nextJson?.let { putExtra(EXTRA_NEXT_CARD, it) }
        }

        return PendingIntent.getBroadcast(
            context,
            // Distinct per action; see the note at the top of this file.
            NOTIFICATION_ID + 1 + index,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun compactView(context: Context, card: SmartCard): RemoteViews =
        RemoteViews(context.packageName, R.layout.smart_card_compact).apply {
            setTextViewText(R.id.smart_card_title, card.title)
            setTextViewText(R.id.smart_card_text, card.text)
        }

    private fun expandedView(context: Context, card: SmartCard): RemoteViews =
        RemoteViews(context.packageName, R.layout.smart_card_expanded).apply {
            setTextViewText(R.id.smart_card_title, card.title)
            setTextViewText(R.id.smart_card_text, card.text)
            if (card.detail != null) {
                setTextViewText(R.id.smart_card_detail, card.detail)
                setViewVisibility(R.id.smart_card_detail, android.view.View.VISIBLE)
            } else {
                setViewVisibility(R.id.smart_card_detail, android.view.View.GONE)
            }
        }
}
