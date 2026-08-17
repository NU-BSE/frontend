package com.creepyim.smartcards

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * The JavaScript-facing module.
 *
 * Everything it exposes is unavailable to JS: notification channels, heads-up
 * importance, RemoteViews, PendingIntent, and the POST_NOTIFICATIONS runtime
 * permission introduced in Android 13.
 */
class SmartCardsModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @ReactMethod
    fun createChannel() {
        SmartCardNotification.createChannel(reactContext)
    }

    @ReactMethod
    fun hasPermission(promise: Promise) {
        promise.resolve(notificationsAllowed())
    }

    /**
     * Request POST_NOTIFICATIONS.
     *
     * Android shows this dialog once. After a denial the request returns
     * immediately with the same answer and no prompt, which is why the JS side
     * is documented not to treat `false` as "ask again" — repeated calls do
     * nothing, and the user has to be sent to system settings instead.
     */
    @ReactMethod
    fun requestPermission(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            // No runtime permission before 13. Whether notifications appear is
            // then purely the user's per-app toggle.
            promise.resolve(notificationsAllowed())
            return
        }

        if (notificationsAllowed()) {
            promise.resolve(true)
            return
        }

        val activity = reactContext.currentActivity
        if (activity !is PermissionAwareActivity) {
            // No foreground Activity to host the dialog. Reporting the current
            // state is honest; pretending to have asked is not.
            promise.resolve(false)
            return
        }

        val listener = PermissionListener { requestCode, permissions, grantResults ->
            if (requestCode != PERMISSION_REQUEST_CODE) return@PermissionListener false
            val granted = permissions.indexOf(Manifest.permission.POST_NOTIFICATIONS)
                .takeIf { it >= 0 }
                ?.let { grantResults.getOrNull(it) == PackageManager.PERMISSION_GRANTED }
                ?: false
            promise.resolve(granted)
            true
        }

        activity.requestPermissions(
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            PERMISSION_REQUEST_CODE,
            listener,
        )
    }

    @ReactMethod
    fun showCard(cardJson: String, promise: Promise) {
        try {
            SmartCardNotification.show(reactContext, SmartCard.parse(cardJson))
            promise.resolve(null)
        } catch (error: IllegalArgumentException) {
            promise.reject("SMART_CARD_INVALID", error.message, error)
        } catch (error: Throwable) {
            // A missing permission surfaces here as a SecurityException from
            // NotificationManagerCompat rather than as a checked condition.
            promise.reject("SMART_CARD_FAILED", error.message, error)
        }
    }

    @ReactMethod
    fun dismiss(notificationId: Double) {
        SmartCardNotification.dismiss(reactContext, notificationId.toInt())
    }

    /** Required by the event emitter contract; the listeners live in JS. */
    @ReactMethod
    fun addListener(eventName: String) = Unit

    @ReactMethod
    fun removeListeners(count: Double) = Unit

    private fun notificationsAllowed(): Boolean {
        if (!NotificationManagerCompat.from(reactContext).areNotificationsEnabled()) {
            return false
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            reactContext,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    companion object {
        const val NAME = "SmartCards"
        const val EVENT_PRESS = "SmartCards.press"
        private const val PERMISSION_REQUEST_CODE = 4242

        /**
         * The live module, if the app is running.
         *
         * Held so the receiver can tell JS about a press. Null whenever the
         * process is not up, which is the normal case and not an error: the
         * card's own behaviour never depends on JS being alive.
         */
        @Volatile
        private var instance: SmartCardsModule? = null

        fun emitPress(actionId: String) {
            val module = instance ?: return
            val context = module.reactContext
            if (!context.hasActiveReactInstance()) return
            context
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(EVENT_PRESS, actionId)
        }

        fun register(module: SmartCardsModule) {
            instance = module
        }
    }

    init {
        register(this)
    }
}
