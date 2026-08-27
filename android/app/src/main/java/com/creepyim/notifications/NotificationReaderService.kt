package com.creepyim.notifications

import android.app.Notification
import android.app.RemoteInput
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

/**
 * Reads the notification shade, and replies to what can be replied to.
 *
 * The platform binds this for as long as the user has granted notification
 * access, independently of whether the app is running, so it must hold nothing
 * expensive and must survive the JS runtime being gone. Posted notifications
 * are kept in a small bounded store that JS reads on demand rather than being
 * pushed across the bridge — a busy phone posts far more than a chat UI could
 * usefully receive.
 *
 * Content is deliberately narrow: package, title, text, timestamp, and whether
 * a reply is possible. No icons, no images, no extras blob. This service sees
 * every notification on the device, including one-time passcodes and banking
 * alerts, so it takes the least it can rather than everything on offer.
 */
class NotificationReaderService : NotificationListenerService() {

    override fun onListenerConnected() {
        super.onListenerConnected()
        connected = true
        // Seed from what is already on screen: a listener connected after the
        // fact would otherwise report an empty shade until something new
        // arrived.
        try {
            activeNotifications?.forEach { remember(it) }
        } catch (error: Throwable) {
            Log.w(TAG, "could not read active notifications", error)
        }
    }

    override fun onListenerDisconnected() {
        connected = false
        super.onListenerDisconnected()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn?.let { remember(it) }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        sbn?.key?.let { NotificationStore.remove(it) }
    }

    private fun remember(sbn: StatusBarNotification) {
        val notification = sbn.notification ?: return

        // Ongoing notifications are chrome — media transport bars, downloads,
        // "app is running". They are not things the user was told.
        if (notification.flags and Notification.FLAG_ONGOING_EVENT != 0) return
        if (sbn.packageName == packageName) return

        val extras = notification.extras
        val title = extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val text = extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString()
        if (title.isNullOrBlank() && text.isNullOrBlank()) return

        NotificationStore.put(
            DeviceNotification(
                key = sbn.key,
                packageName = sbn.packageName,
                title = title,
                text = text,
                postedAt = sbn.postTime,
                canReply = replyAction(notification) != null,
            ),
        )
    }

    /**
     * Sends a reply through a notification's own reply action.
     *
     * This is how a message is answered without opening the app: the messaging
     * app published a PendingIntent expecting a RemoteInput, and firing it
     * with the text filled in is exactly what its own UI does. It works only
     * where the app offered a reply action — there is no way to synthesise one.
     */
    fun reply(key: String, message: String): Boolean {
        val sbn = try {
            getActiveNotifications(arrayOf(key))?.firstOrNull()
        } catch (error: Throwable) {
            Log.w(TAG, "could not resolve notification $key", error)
            null
        } ?: return false

        val notification = sbn.notification ?: return false
        val action = replyAction(notification) ?: return false
        val inputs = action.remoteInputs ?: return false
        val intent = action.actionIntent ?: return false

        return try {
            val fill = Intent()
            val results = Bundle()
            for (input in inputs) {
                results.putCharSequence(input.resultKey, message)
            }
            RemoteInput.addResultsToIntent(inputs, fill, results)
            intent.send(this as Context, 0, fill)
            true
        } catch (error: Throwable) {
            Log.w(TAG, "reply failed for $key", error)
            false
        }
    }

    /**
     * The first action that accepts free-form text.
     *
     * `getAllowFreeFormInput` matters: some apps attach RemoteInputs that only
     * accept preset choices, and filling those with arbitrary text produces a
     * silent no-op rather than a message.
     */
    private fun replyAction(notification: Notification): Notification.Action? =
        notification.actions?.firstOrNull { action ->
            action.remoteInputs?.any { it.allowFreeFormInput } == true
        }

    companion object {
        private const val TAG = "NotificationReader"

        /**
         * Whether the platform currently has this service bound.
         *
         * Access being granted and the service being connected are different:
         * the bind is asynchronous after a grant, and the system may rebind
         * later, so a caller that assumes the grant implies a live listener
         * reads an empty shade.
         */
        @Volatile
        var connected: Boolean = false
            private set

        @Volatile
        private var instance: NotificationReaderService? = null

        fun current(): NotificationReaderService? = instance
    }

    init {
        instance = this
    }
}

/** One notification, reduced to what the agent can act on. */
data class DeviceNotification(
    val key: String,
    val packageName: String,
    val title: String?,
    val text: String?,
    val postedAt: Long,
    val canReply: Boolean,
)

/**
 * The recent shade.
 *
 * Bounded and ordered by arrival. A phone can post hundreds of notifications
 * an hour, and an unbounded store in a service that runs for days is a leak
 * with a privacy cost attached.
 */
object NotificationStore {
    private const val MAX = 100

    private val entries = LinkedHashMap<String, DeviceNotification>()

    @Synchronized
    fun put(notification: DeviceNotification) {
        // Re-put moves it to the end: an updated conversation is recent again.
        entries.remove(notification.key)
        entries[notification.key] = notification
        while (entries.size > MAX) {
            val oldest = entries.keys.firstOrNull() ?: break
            entries.remove(oldest)
        }
    }

    @Synchronized
    fun remove(key: String) {
        entries.remove(key)
    }

    @Synchronized
    fun snapshot(): List<DeviceNotification> = entries.values.sortedByDescending { it.postedAt }

    @Synchronized
    fun clear() = entries.clear()
}
