package expo.modules.creepyandroidsettings

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings

/**
 * Opens Android Settings screens and app-scoped Settings destinations through
 * public Settings.ACTION_* / Settings.Panel.* intents only.
 *
 * Global screens stay as a small enum. Anything that addresses a particular
 * application is parameterized explicitly with a package name (and channel id
 * where Android requires one) so the agent can never silently fall back to
 * Creepy.IM's own package.
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
            "apps",
            "allApps",
            "defaultApps",
            "home",
            "batterySaver",
            "dataUsage",
            "airplaneMode",
            "apn",
            "roaming",
            "doNotDisturb",
            "storage",
            "deviceInfo",
            "systemUpdate",
            "sync",
            "addAccount",
            "userDictionary",
            "hardwareKeyboard",
            "captioning",
            "cast",
            "print",
            "dream",
            "autoRotateSettings",
            "webView",
            "allNotifications",
        )

        val APP_TARGETS: List<String> = listOf(
            "appDetails",
            "appNotifications",
            "notificationChannel",
            "notificationBubbles",
            "appOpenByDefault",
            "appLocale",
            "appUsage",
            "backgroundData",
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

    fun canOpenAppTarget(target: String, packageName: String, channelId: String?): Boolean {
        val intent = buildAppTargetIntent(target, packageName, channelId) ?: return false
        return isResolvable(intent)
    }

    fun openAppTarget(target: String, packageName: String, channelId: String?): Boolean {
        val intent = buildAppTargetIntent(target, packageName, channelId)
            ?: throw UnknownSettingsScreenException(target)
        if (!isResolvable(intent)) {
            throw SettingsScreenUnavailableException(target)
        }
        startActivity(intent, target)
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

    fun canOpenWriteSettings(): Boolean = isResolvable(writeSettingsIntent())

    fun openWriteSettings(): Boolean {
        val intent = writeSettingsIntent()
        if (!isResolvable(intent)) throw SettingsScreenUnavailableException("writeSettings")
        startActivity(intent, "writeSettings")
        return true
    }

    fun canOpenOverlay(): Boolean = isResolvable(overlayIntent())

    fun openOverlay(): Boolean {
        val intent = overlayIntent()
        if (!isResolvable(intent)) throw SettingsScreenUnavailableException("overlay")
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
        return if (requiresOwnPackageUri(screen)) {
            Intent(action, Uri.parse("package:${context.packageName}"))
        } else {
            Intent(action)
        }
    }

    private fun buildAppTargetIntent(
        target: String,
        packageName: String,
        channelId: String?,
    ): Intent? {
        if (packageName.isBlank()) throw InvalidArgumentException("packageName must not be empty.")

        val packageUri = Uri.parse("package:$packageName")
        return when (target) {
            "appDetails" -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri)
            "appNotifications" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                } else null
            "notificationChannel" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    if (channelId.isNullOrBlank()) {
                        throw InvalidArgumentException(
                            "channelId is required for notificationChannel settings.",
                        )
                    }
                    Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                        .putExtra(Settings.EXTRA_CHANNEL_ID, channelId)
                } else null
            "notificationBubbles" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    Intent(Settings.ACTION_APP_NOTIFICATION_BUBBLE_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                } else null
            "appOpenByDefault" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    Intent(Settings.ACTION_APP_OPEN_BY_DEFAULT_SETTINGS, packageUri)
                } else null
            "appLocale" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    Intent(Settings.ACTION_APP_LOCALE_SETTINGS, packageUri)
                } else null
            "appUsage" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    Intent(Settings.ACTION_APP_USAGE_SETTINGS)
                        .putExtra(Intent.EXTRA_PACKAGE_NAME, packageName)
                } else null
            "backgroundData" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    Intent(Settings.ACTION_IGNORE_BACKGROUND_DATA_RESTRICTIONS_SETTINGS, packageUri)
                } else null
            else -> null
        }
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

    /** Legacy self-app destinations kept for direct module consumers. */
    private fun requiresOwnPackageUri(screen: String): Boolean =
        screen == "appDetails" ||
            screen == "overlay" ||
            screen == "writeSettings" ||
            screen == "unknownSources"

    private fun screenAction(screen: String): String? = when (screen) {
        "settings" -> Settings.ACTION_SETTINGS
        "appDetails" -> Settings.ACTION_APPLICATION_DETAILS_SETTINGS
        "wifi" -> Settings.ACTION_WIFI_SETTINGS
        "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
        "wireless" -> Settings.ACTION_WIRELESS_SETTINGS
        "location" -> Settings.ACTION_LOCATION_SOURCE_SETTINGS
        "display" -> Settings.ACTION_DISPLAY_SETTINGS
        "sound" -> Settings.ACTION_SOUND_SETTINGS
        // Top-level notification settings. Per-app notifications use APP_TARGETS.
        "notifications" -> Settings.ACTION_NOTIFICATION_SETTINGS
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
        "apps" -> Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS
        "allApps" -> Settings.ACTION_MANAGE_ALL_APPLICATIONS_SETTINGS
        "defaultApps" ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS else null
        "home" ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) Settings.ACTION_HOME_SETTINGS else null
        "batterySaver" ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) Settings.ACTION_BATTERY_SAVER_SETTINGS else null
        "dataUsage" ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) Settings.ACTION_DATA_USAGE_SETTINGS else null
        "airplaneMode" -> Settings.ACTION_AIRPLANE_MODE_SETTINGS
        "apn" -> Settings.ACTION_APN_SETTINGS
        "roaming" -> Settings.ACTION_DATA_ROAMING_SETTINGS
        "doNotDisturb" ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) Settings.ACTION_ZEN_MODE_SETTINGS else null
        "storage" -> Settings.ACTION_INTERNAL_STORAGE_SETTINGS
        "deviceInfo" -> Settings.ACTION_DEVICE_INFO_SETTINGS
        "systemUpdate" -> Settings.ACTION_SYSTEM_UPDATE_SETTINGS
        "sync" -> Settings.ACTION_SYNC_SETTINGS
        "addAccount" -> Settings.ACTION_ADD_ACCOUNT
        "userDictionary" -> Settings.ACTION_USER_DICTIONARY_SETTINGS
        "hardwareKeyboard" ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) Settings.ACTION_HARD_KEYBOARD_SETTINGS else null
        "captioning" ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) Settings.ACTION_CAPTIONING_SETTINGS else null
        "cast" ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) Settings.ACTION_CAST_SETTINGS else null
        "print" ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) Settings.ACTION_PRINT_SETTINGS else null
        "dream" ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) Settings.ACTION_DREAM_SETTINGS else null
        "autoRotateSettings" ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Settings.ACTION_AUTO_ROTATE_SETTINGS else null
        "webView" ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) Settings.ACTION_WEBVIEW_SETTINGS else null
        "allNotifications" ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) Settings.ACTION_ALL_APPS_NOTIFICATION_SETTINGS else null
        else -> null
    }
}
