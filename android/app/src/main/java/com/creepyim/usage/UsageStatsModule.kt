package com.creepyim.usage

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Process
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray

/**
 * App usage history, for the predictor that suggests what the user is about
 * to reach for.
 *
 * Usage access is not a runtime permission and cannot be requested with a
 * dialog: the user has to grant it on a system settings screen, and the app
 * only learns the answer by re-checking when it comes back to the foreground.
 * That is why this exposes state and a way to open the screen, rather than a
 * `request()` that resolves.
 *
 * Only foreground transitions are reported. The full event stream also carries
 * screen-on, notification-seen, configuration changes and more, and none of
 * that says anything about which app a person chose to open — which is the
 * only question the predictor asks.
 */
class UsageStatsModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    /**
     * Whether usage access has been granted.
     *
     * Checked through AppOps rather than by attempting a query: a query
     * without permission returns an empty result rather than failing, which is
     * indistinguishable from a device that has genuinely not been used.
     */
    @ReactMethod
    fun hasPermission(promise: Promise) {
        promise.resolve(granted())
    }

    /** Opens the system screen where usage access is granted. */
    @ReactMethod
    fun openSettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
            promise.resolve(true)
        } catch (error: Throwable) {
            // Some builds hide the screen entirely; reporting false is more
            // useful than an exception the caller cannot act on.
            promise.resolve(false)
        }
    }

    /**
     * Foreground events between two instants, oldest first.
     *
     * `sinceMs`/`untilMs` are Unix milliseconds. The platform keeps only a few
     * weeks of history and silently clamps a wider window, so a caller must
     * not read an empty result as "the user opened nothing".
     */
    @ReactMethod
    fun queryEvents(sinceMs: Double, untilMs: Double, promise: Promise) {
        if (!granted()) {
            promise.reject(
                "USAGE_NO_PERMISSION",
                "Usage access has not been granted.",
            )
            return
        }

        val manager = reactContext.getSystemService(Context.USAGE_STATS_SERVICE)
            as? UsageStatsManager
        if (manager == null) {
            promise.reject("USAGE_UNAVAILABLE", "This device has no usage stats service.")
            return
        }

        try {
            val events = manager.queryEvents(sinceMs.toLong(), untilMs.toLong())
            val out: WritableArray = Arguments.createArray()
            val event = UsageEvents.Event()
            val self = reactContext.packageName

            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                if (event.eventType != foregroundEventType()) continue
                val packageName = event.packageName ?: continue
                // Creepy opening itself is not a signal about what the user
                // wants next; including it would have the predictor recommend
                // the app the user is already looking at.
                if (packageName == self) continue

                out.pushMap(
                    Arguments.createMap().apply {
                        putString("packageName", packageName)
                        // Seconds, because that is what the predictor's
                        // UsageEvent uses; milliseconds here would be read as
                        // timestamps fifty thousand years from now.
                        putDouble("at", event.timeStamp / 1000.0)
                    },
                )
            }
            promise.resolve(out)
        } catch (error: Throwable) {
            promise.reject("USAGE_QUERY_FAILED", error.message, error)
        }
    }

    /**
     * ACTIVITY_RESUMED replaced MOVE_TO_FOREGROUND in API 29.
     *
     * They share the value 1, so this is documentation rather than arithmetic
     * — but naming it keeps the intent legible if the constants ever diverge.
     */
    private fun foregroundEventType(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            UsageEvents.Event.ACTIVITY_RESUMED
        } else {
            @Suppress("DEPRECATION")
            UsageEvents.Event.MOVE_TO_FOREGROUND
        }

    private fun granted(): Boolean {
        val appOps = reactContext.getSystemService(Context.APP_OPS_SERVICE)
            as? AppOpsManager ?: return false
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                reactContext.packageName,
            )
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                reactContext.packageName,
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    companion object {
        const val NAME = "UsageStats"
    }
}
