package expo.modules.creepyandroidsettings

import android.content.ContentResolver
import android.provider.Settings

/**
 * Read-only access to `Settings.System`, `Settings.Secure` and `Settings.Global`.
 *
 * Every read is wrapped so that underlying provider failures surface as a
 * normalized [SettingReadFailedException] instead of a raw `Exception`.
 */
class SettingsReader(private val resolver: ContentResolver) {

    fun getString(namespace: SettingsNamespace, key: String): String? = try {
        when (namespace) {
            SettingsNamespace.SYSTEM -> Settings.System.getString(resolver, key)
            SettingsNamespace.SECURE -> Settings.Secure.getString(resolver, key)
            SettingsNamespace.GLOBAL -> Settings.Global.getString(resolver, key)
        }
    } catch (e: Exception) {
        throw SettingReadFailedException(namespace.value, key, e)
    }

    fun getInt(namespace: SettingsNamespace, key: String, defaultValue: Int): Int = try {
        when (namespace) {
            SettingsNamespace.SYSTEM -> Settings.System.getInt(resolver, key, defaultValue)
            SettingsNamespace.SECURE -> Settings.Secure.getInt(resolver, key, defaultValue)
            SettingsNamespace.GLOBAL -> Settings.Global.getInt(resolver, key, defaultValue)
        }
    } catch (e: Exception) {
        throw SettingReadFailedException(namespace.value, key, e)
    }

    fun getFloat(namespace: SettingsNamespace, key: String, defaultValue: Float): Float = try {
        when (namespace) {
            SettingsNamespace.SYSTEM -> Settings.System.getFloat(resolver, key, defaultValue)
            SettingsNamespace.SECURE -> Settings.Secure.getFloat(resolver, key, defaultValue)
            SettingsNamespace.GLOBAL -> Settings.Global.getFloat(resolver, key, defaultValue)
        }
    } catch (e: Exception) {
        throw SettingReadFailedException(namespace.value, key, e)
    }

    fun getLong(namespace: SettingsNamespace, key: String, defaultValue: Long): Long = try {
        when (namespace) {
            SettingsNamespace.SYSTEM -> Settings.System.getLong(resolver, key, defaultValue)
            SettingsNamespace.SECURE -> Settings.Secure.getLong(resolver, key, defaultValue)
            SettingsNamespace.GLOBAL -> Settings.Global.getLong(resolver, key, defaultValue)
        }
    } catch (e: Exception) {
        throw SettingReadFailedException(namespace.value, key, e)
    }
}
