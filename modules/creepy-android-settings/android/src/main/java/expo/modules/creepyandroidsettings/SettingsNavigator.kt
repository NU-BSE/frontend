package expo.modules.creepyandroidsettings

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings

/**
 * Opens Android Settings screens and Settings Panels through the official
 * `Settings.ACTION_*` / `Settings.Panel.*` intents only.
 *
 * No OEM activity class names are used; availability is resolved through the
 * [android.content.pm.PackageManager] before starting any activity so that
 * unsupported screens fail with a controlled result instead of crashing.
 */
class SettingsNavigator(private val context: Context) {

    companion object {
        val SCREENS: List<String> = listOf(
            "settings",
            "appDetails",
            "wifi",
            "bluetooth",
            "wireless",
            "location",
            "display",
            "sound",
            "notifications",
            "accessibility",
            "usageAccess",
            "notificationListener",
            "overlay",
            "writeSettings",
            "batteryOptimization",
            "unknownSources",
            "security",
            "privacy",
            "vpn",
            "nfc",
            "language",
            "dateTime",
            "keyboard",
            "developerOptions",
        )

        val PANELS: List<String> = listOf("internet", "wifi", "volume", "nfc")
    }

    fun canOpenScreen(screen: String): Boolean {
        val intent = buildScreenIntent(screen) ?: return false
        return isResolvable(intent)
    }

    fun openScreen(screen: String): Boolean {
        val intent = buildScreenIntent(screen) ?: throw UnknownSettingsScreenException(screen)
        if (!isResolvable(intent)) {
            throw SettingsScreenUnavailableException(screen)
        }
        startActivity(intent, screen)
        return true
    }

    fun isPanelSupported(panel: String): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
        val intent = buildPanelIntent(panel) ?: return false
        return isResolvable(intent)
    }

    fun openPanel(panel: String): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            throw SettingsPanelUnavailableException(panel)
        }
        val intent = buildPanelIntent(panel) ?: throw SettingsPanelUnavailableException(panel)
        if (!isResolvable(intent)) {
            throw SettingsPanelUnavailableException(panel)
        }
        startActivity(intent, panel)
        return true
    }

    fun canOpenWriteSettings(): Boolean {
        val intent = writeSettingsIntent()
        return isResolvable(intent)
    }

    fun openWriteSettings(): Boolean {
        val intent = writeSettingsIntent()
        if (!isResolvable(intent)) {
            throw SettingsScreenUnavailableException("writeSettings")
        }
        startActivity(intent, "writeSettings")
        return true
    }

    fun canOpenOverlay(): Boolean {
        val intent = overlayIntent()
        return isResolvable(intent)
    }

    fun openOverlay(): Boolean {
        val intent = overlayIntent()
        if (!isResolvable(intent)) {
            throw SettingsScreenUnavailableException("overlay")
        }
        startActivity(intent, "overlay")
        return true
    }

    private fun writeSettingsIntent(): Intent =
        Intent(
            Settings.ACTION_MANAGE_WRITE_SETTINGS,
            Uri.parse("package:${context.packageName}"),
        )

    private fun overlayIntent(): Intent =
        Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:${context.packageName}"),
        )

    private fun isResolvable(intent: Intent): Boolean =
        intent.resolveActivity(context.packageManager) != null

    private fun startActivity(intent: Intent, label: String) {
        val launchable = intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(launchable)
        } catch (e: ActivityNotFoundException) {
            throw SettingsScreenUnavailableException(label, e)
        } catch (e: SecurityException) {
            throw SettingsScreenUnavailableException(label, e)
        }
    }

    private fun buildScreenIntent(screen: String): Intent? {
        val action = screenAction(screen) ?: return null
        val intent = if (requiresPackageUri(screen)) {
            Intent(action, Uri.parse("package:${context.packageName}"))
        } else {
            Intent(action)
        }
        return intent
    }

    private fun buildPanelIntent(panel: String): Intent? {
        val action = when (panel) {
            "internet" -> Settings.Panel.ACTION_INTERNET_CONNECTIVITY
            "wifi" -> Settings.Panel.ACTION_WIFI
            "volume" -> Settings.Panel.ACTION_VOLUME
            "nfc" -> Settings.Panel.ACTION_NFC
            else -> null
        }
        return action?.let { Intent(it) }
    }

    private fun requiresPackageUri(screen: String): Boolean =
        screen == "appDetails" || screen == "overlay" || screen == "writeSettings" || screen == "usageAccess"

    private fun screenAction(screen: String): String? = when (screen) {
        "settings" -> Settings.ACTION_SETTINGS
        "appDetails" -> Settings.ACTION_APPLICATION_DETAILS_SETTINGS
        "wifi" -> Settings.ACTION_WIFI_SETTINGS
        "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
        "wireless" -> Settings.ACTION_WIRELESS_SETTINGS
        "location" -> Settings.ACTION_LOCATION_SOURCE_SETTINGS
        "display" -> Settings.ACTION_DISPLAY_SETTINGS
        "sound" -> Settings.ACTION_SOUND_SETTINGS
        "notifications" ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Settings.ACTION_APP_NOTIFICATION_SETTINGS else null
        "accessibility" -> Settings.ACTION_ACCESSIBILITY_SETTINGS
        "usageAccess" -> Settings.ACTION_USAGE_ACCESS_SETTINGS
        "notificationListener" -> Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS
        "overlay" -> Settings.ACTION_MANAGE_OVERLAY_PERMISSION
        "writeSettings" -> Settings.ACTION_MANAGE_WRITE_SETTINGS
        "batteryOptimization" -> Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS
        "unknownSources" ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES else null
        "security" -> Settings.ACTION_SECURITY_SETTINGS
        "privacy" -> Settings.ACTION_PRIVACY_SETTINGS
        "vpn" -> Settings.ACTION_VPN_SETTINGS
        "nfc" -> Settings.ACTION_NFC_SETTINGS
        "language" -> Settings.ACTION_LOCALE_SETTINGS
        "dateTime" -> Settings.ACTION_DATE_SETTINGS
        "keyboard" -> Settings.ACTION_INPUT_METHOD_SETTINGS
        "developerOptions" -> Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS
        else -> null
    }
}
