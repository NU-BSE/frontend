package com.creepyim.notifications

import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * The notification shade, exposed to JavaScript.
 *
 * Like usage access, notification access is granted on a system screen rather
 * than through a dialog, so this offers state plus a way to open the screen
 * and leaves the caller to re-check on return to the foreground.
 */
class NotificationReaderModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    /**
     * Whether the user has granted notification access.
     *
     * Read from the enabled-listeners setting rather than inferred from the
     * service being alive: the service is bound asynchronously, so a fresh
     * grant would otherwise look like a refusal.
     */
    @ReactMethod
    fun hasPermission(promise: Promise) {
        promise.resolve(granted())
    }

    /** Whether the platform has actually bound the listener yet. */
    @ReactMethod
    fun isConnected(promise: Promise) {
        promise.resolve(NotificationReaderService.connected)
    }

    @ReactMethod
    fun openSettings(promise: Promise) {
        try {
            reactContext.startActivity(
                Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            promise.resolve(true)
        } catch (error: Throwable) {
            promise.resolve(false)
        }
    }

    /** The recent shade, newest first. */
    @ReactMethod
    fun getNotifications(promise: Promise) {
        if (!granted()) {
            promise.reject(
                "NOTIFICATIONS_NO_PERMISSION",
                "Notification access has not been granted.",
            )
            return
        }
        val out = Arguments.createArray()
        for (entry in NotificationStore.snapshot()) {
            out.pushMap(
                Arguments.createMap().apply {
                    putString("key", entry.key)
                    putString("packageName", entry.packageName)
                    entry.title?.let { putString("title", it) }
                    entry.text?.let { putString("text", it) }
                    putDouble("postedAt", entry.postedAt.toDouble())
                    putBoolean("canReply", entry.canReply)
                },
            )
        }
        promise.resolve(out)
    }

    /**
     * Replies to a notification through its own reply action.
     *
     * Resolves false when the notification is gone or never offered a reply,
     * which are ordinary states rather than errors — a conversation the user
     * has already opened elsewhere has no reply action left to use.
     */
    @ReactMethod
    fun reply(key: String, message: String, promise: Promise) {
        if (!granted()) {
            promise.reject(
                "NOTIFICATIONS_NO_PERMISSION",
                "Notification access has not been granted.",
            )
            return
        }
        if (message.isBlank()) {
            promise.reject("NOTIFICATIONS_EMPTY_REPLY", "The reply is empty.")
            return
        }
        val service = NotificationReaderService.current()
        if (service == null) {
            promise.reject(
                "NOTIFICATIONS_NOT_CONNECTED",
                "The notification listener is not running yet.",
            )
            return
        }
        promise.resolve(service.reply(key, message))
    }

    private fun granted(): Boolean {
        val enabled = Settings.Secure.getString(
            reactContext.contentResolver,
            ENABLED_LISTENERS,
        ) ?: return false
        val expected = ComponentName(
            reactContext.packageName,
            NotificationReaderService::class.java.name,
        )
        /*
         * The setting is a colon-separated list of flattened component names,
         * and a substring match on the package would also accept a different
         * service of ours, or another app whose package name contains ours.
         */
        return enabled.split(':').any { entry ->
            ComponentName.unflattenFromString(entry) == expected
        }
    }

    companion object {
        const val NAME = "NotificationReader"

        /** Settings.Secure.ENABLED_NOTIFICATION_LISTENERS — public as a string. */
        private const val ENABLED_LISTENERS = "enabled_notification_listeners"
    }
}
