package expo.modules.creepyandroidsettings

import android.content.Context
import android.provider.Settings

/**
 * Write access restricted to `Settings.System`.
 *
 * Android intentionally does not let ordinary apps mutate `Settings.Secure` or
 * `Settings.Global`; even though `put*` methods exist in the SDK, they are not
 * part of the public write surface of this module.
 *
 * Every write first checks [Settings.System.canWrite] and throws
 * [WriteSettingsPermissionRequiredException] when WRITE_SETTINGS has not been
 * granted by the user through the special-access screen.
 */
class SettingsWriter(private val context: Context) {

    fun canWrite(): Boolean = Settings.System.canWrite(context)

    private fun requireWritePermission(key: String) {
        if (!Settings.System.canWrite(context)) {
            throw WriteSettingsPermissionRequiredException(key)
        }
    }

    fun putInt(key: String, value: Int): Boolean {
        requireWritePermission(key)
        return try {
            Settings.System.putInt(context.contentResolver, key, value)
        } catch (e: Exception) {
            throw SettingWriteFailedException("System", key, e)
        }
    }

    fun putString(key: String, value: String): Boolean {
        requireWritePermission(key)
        return try {
            Settings.System.putString(context.contentResolver, key, value)
        } catch (e: Exception) {
            throw SettingWriteFailedException("System", key, e)
        }
    }

    fun putFloat(key: String, value: Float): Boolean {
        requireWritePermission(key)
        return try {
            Settings.System.putFloat(context.contentResolver, key, value)
        } catch (e: Exception) {
            throw SettingWriteFailedException("System", key, e)
        }
    }

    fun putLong(key: String, value: Long): Boolean {
        requireWritePermission(key)
        return try {
            Settings.System.putLong(context.contentResolver, key, value)
        } catch (e: Exception) {
            throw SettingWriteFailedException("System", key, e)
        }
    }
}
