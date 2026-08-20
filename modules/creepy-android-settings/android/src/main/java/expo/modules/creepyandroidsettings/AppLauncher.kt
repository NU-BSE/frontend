package expo.modules.creepyandroidsettings

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent

/** Narrow launcher for starting an installed app by its package name. */
class AppLauncher(private val context: Context) {
    fun openApp(packageName: String): Boolean {
        if (packageName.isBlank()) throw InvalidArgumentException("packageName must not be empty.")
        val intent = context.packageManager.getLaunchIntentForPackage(packageName) ?: return false
        return try {
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (_: ActivityNotFoundException) {
            false
        } catch (_: SecurityException) {
            false
        }
    }
}
