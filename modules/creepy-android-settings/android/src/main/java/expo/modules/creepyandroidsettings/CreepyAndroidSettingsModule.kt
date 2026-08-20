package expo.modules.creepyandroidsettings

import android.content.Context
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo Modules API surface for Creepy.IM's Android device bridge.
 *
 * Settings, package lookup and outward intents are split into focused helpers.
 * The model-facing connector exposes only typed operations; the low-level
 * Settings provider methods remain available to trusted app code only.
 */
class CreepyAndroidSettingsModule : Module() {

    private val context: Context
        get() = appContext.reactContext ?: throw AndroidContextUnavailableException()

    private val reader: SettingsReader by lazy { SettingsReader(context.contentResolver) }
    private val writer: SettingsWriter by lazy { SettingsWriter(context) }
    private val navigator: SettingsNavigator by lazy { SettingsNavigator(context) }
    private val appManager: AppManager by lazy { AppManager(context.packageManager) }
    private val appLauncher: AppLauncher by lazy { AppLauncher(context) }
    private val shareLauncher: ShareLauncher by lazy { ShareLauncher(context) }
    private val externalLauncher: ExternalActionLauncher by lazy { ExternalActionLauncher(context) }

    private var observerManager: SettingsObserverManager? = null

    private fun requireObserverManager(): SettingsObserverManager {
        return observerManager ?: SettingsObserverManager(context.contentResolver) { id, namespace, key, value, timestamp ->
            sendEvent(
                "onSettingChanged",
                mapOf(
                    "subscriptionId" to id,
                    "namespace" to namespace.value,
                    "key" to key,
                    "value" to value,
                    "timestamp" to timestamp,
                ),
            )
        }.also { observerManager = it }
    }

    override fun definition() = ModuleDefinition {
        Name("CreepyAndroidSettings")

        Events("onSettingChanged")

        OnDestroy {
            observerManager?.unwatchAll()
        }

        // region Capabilities

        Function("getCapabilities") {
            val supportedScreens = linkedMapOf<String, Boolean>()
            for (screen in SettingsNavigator.SCREENS) {
                supportedScreens[screen] = navigator.canOpenScreen(screen)
            }

            val supportedAppTargets = linkedMapOf<String, Boolean>()
            for (target in SettingsNavigator.APP_TARGETS) {
                supportedAppTargets[target] = navigator.canOpenAppTarget(
                    target,
                    context.packageName,
                    if (target == "notificationChannel") "default" else null,
                )
            }

            val capabilities: Map<String, Any?> = linkedMapOf(
                "platform" to "android",
                "apiLevel" to Build.VERSION.SDK_INT,
                "manufacturer" to Build.MANUFACTURER,
                "model" to Build.MODEL,
                "canWriteSystemSettings" to Settings.System.canWrite(context),
                "canDrawOverlays" to Settings.canDrawOverlays(context),
                "settingsPanelsSupported" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q),
                "supportedScreens" to supportedScreens,
                "supportedAppTargets" to supportedAppTargets,
            )
            capabilities
        }

        // endregion

        // region Generic reads

        Function("getSetting") { namespace: String, key: String ->
            requireKey(key)
            reader.getString(SettingsNamespace.from(namespace), key)
        }

        Function("getSettingInt") { namespace: String, key: String, defaultValue: Int ->
            requireKey(key)
            reader.getInt(SettingsNamespace.from(namespace), key, defaultValue)
        }

        // endregion

        // region Settings.System reads

        Function("getSystemInt") { key: String, defaultValue: Int ->
            requireKey(key)
            reader.getInt(SettingsNamespace.SYSTEM, key, defaultValue)
        }

        Function("getSystemString") { key: String ->
            requireKey(key)
            reader.getString(SettingsNamespace.SYSTEM, key)
        }

        Function("getSystemFloat") { key: String, defaultValue: Float ->
            requireKey(key)
            reader.getFloat(SettingsNamespace.SYSTEM, key, defaultValue)
        }

        Function("getSystemLong") { key: String, defaultValue: Long ->
            requireKey(key)
            reader.getLong(SettingsNamespace.SYSTEM, key, defaultValue)
        }

        // endregion

        // region Settings.Secure reads

        Function("getSecureInt") { key: String, defaultValue: Int ->
            requireKey(key)
            reader.getInt(SettingsNamespace.SECURE, key, defaultValue)
        }

        Function("getSecureString") { key: String ->
            requireKey(key)
            reader.getString(SettingsNamespace.SECURE, key)
        }

        Function("getSecureFloat") { key: String, defaultValue: Float ->
            requireKey(key)
            reader.getFloat(SettingsNamespace.SECURE, key, defaultValue)
        }

        Function("getSecureLong") { key: String, defaultValue: Long ->
            requireKey(key)
            reader.getLong(SettingsNamespace.SECURE, key, defaultValue)
        }

        // endregion

        // region Settings.Global reads

        Function("getGlobalInt") { key: String, defaultValue: Int ->
            requireKey(key)
            reader.getInt(SettingsNamespace.GLOBAL, key, defaultValue)
        }

        Function("getGlobalString") { key: String ->
            requireKey(key)
            reader.getString(SettingsNamespace.GLOBAL, key)
        }

        Function("getGlobalFloat") { key: String, defaultValue: Float ->
            requireKey(key)
            reader.getFloat(SettingsNamespace.GLOBAL, key, defaultValue)
        }

        Function("getGlobalLong") { key: String, defaultValue: Long ->
            requireKey(key)
            reader.getLong(SettingsNamespace.GLOBAL, key, defaultValue)
        }

        // endregion

        // region Settings.System writes (trusted app code only)

        Function("setSystemInt") { key: String, value: Int ->
            requireKey(key)
            writer.putInt(key, value)
        }

        Function("setSystemString") { key: String, value: String ->
            requireKey(key)
            writer.putString(key, value)
        }

        Function("setSystemFloat") { key: String, value: Float ->
            requireKey(key)
            writer.putFloat(key, value)
        }

        Function("setSystemLong") { key: String, value: Long ->
            requireKey(key)
            writer.putLong(key, value)
        }

        // endregion

        // region Special access

        Function("canWriteSystemSettings") {
            Settings.System.canWrite(context)
        }

        AsyncFunction("requestWriteSystemSettingsPermission") {
            if (navigator.canOpenWriteSettings()) navigator.openWriteSettings()
            Settings.System.canWrite(context)
        }

        Function("canDrawOverlays") {
            Settings.canDrawOverlays(context)
        }

        AsyncFunction("requestOverlayPermission") {
            if (navigator.canOpenOverlay()) navigator.openOverlay()
            Settings.canDrawOverlays(context)
        }

        // endregion

        // region Typed high-level settings

        Function("getScreenBrightness") {
            reader.getInt(SettingsNamespace.SYSTEM, Settings.System.SCREEN_BRIGHTNESS, 0)
        }

        Function("setScreenBrightness") { value: Int ->
            requireInRange(value, 0, 255, "brightness")
            writer.putInt(Settings.System.SCREEN_BRIGHTNESS, value)
        }

        Function("getScreenBrightnessPercent") {
            val brightness = reader.getInt(SettingsNamespace.SYSTEM, Settings.System.SCREEN_BRIGHTNESS, 0)
            percentFromBrightness(brightness)
        }

        Function("setScreenBrightnessPercent") { percent: Int ->
            requireInRange(percent, 0, 100, "percent")
            writer.putInt(Settings.System.SCREEN_BRIGHTNESS, brightnessFromPercent(percent))
        }

        Function("getScreenTimeout") {
            reader.getInt(SettingsNamespace.SYSTEM, Settings.System.SCREEN_OFF_TIMEOUT, 0)
        }

        Function("setScreenTimeout") { milliseconds: Int ->
            requireNonNegative(milliseconds, "milliseconds")
            writer.putInt(Settings.System.SCREEN_OFF_TIMEOUT, milliseconds)
        }

        Function("getAutoRotate") {
            reader.getInt(SettingsNamespace.SYSTEM, Settings.System.ACCELEROMETER_ROTATION, 0) == 1
        }

        Function("setAutoRotate") { enabled: Boolean ->
            writer.putInt(Settings.System.ACCELEROMETER_ROTATION, if (enabled) 1 else 0)
        }

        Function("getBrightnessMode") {
            if (
                reader.getInt(
                    SettingsNamespace.SYSTEM,
                    Settings.System.SCREEN_BRIGHTNESS_MODE,
                    Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL,
                ) == Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC
            ) "automatic" else "manual"
        }

        Function("setBrightnessMode") { mode: String ->
            val value = when (mode) {
                "manual" -> Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL
                "automatic" -> Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC
                else -> throw InvalidArgumentException(
                    "brightness mode must be 'manual' or 'automatic'.",
                )
            }
            writer.putInt(Settings.System.SCREEN_BRIGHTNESS_MODE, value)
        }

        Function("getHapticFeedbackEnabled") {
            reader.getInt(SettingsNamespace.SYSTEM, Settings.System.HAPTIC_FEEDBACK_ENABLED, 1) == 1
        }

        Function("setHapticFeedbackEnabled") { enabled: Boolean ->
            writer.putInt(Settings.System.HAPTIC_FEEDBACK_ENABLED, if (enabled) 1 else 0)
        }

        Function("getSoundEffectsEnabled") {
            reader.getInt(SettingsNamespace.SYSTEM, Settings.System.SOUND_EFFECTS_ENABLED, 1) == 1
        }

        Function("setSoundEffectsEnabled") { enabled: Boolean ->
            writer.putInt(Settings.System.SOUND_EFFECTS_ENABLED, if (enabled) 1 else 0)
        }

        // endregion

        // region Settings navigation

        Function("canOpenSettings") { screen: String ->
            navigator.canOpenScreen(screen)
        }

        AsyncFunction("openSettings") { screen: String ->
            navigator.openScreen(screen)
        }

        Function("canOpenAppSettings") { target: String, packageName: String, channelId: String? ->
            navigator.canOpenAppTarget(target, packageName, channelId)
        }

        AsyncFunction("openAppSettings") { target: String, packageName: String, channelId: String? ->
            navigator.openAppTarget(target, packageName, channelId)
        }

        Function("isSettingsPanelSupported") { panel: String ->
            navigator.isPanelSupported(panel)
        }

        AsyncFunction("openPanel") { panel: String ->
            navigator.openPanel(panel)
        }

        // endregion

        // region Installed applications

        Function("findApps") { query: String, limit: Int ->
            appManager.findApps(query, limit)
        }

        Function("getAppInfo") { packageName: String ->
            appManager.getAppInfo(packageName)
        }

        // endregion

        // region Outward intents

        AsyncFunction("intentOpenUri") { uri: String -> externalLauncher.openUri(uri) }
        AsyncFunction("intentOpenApp") { packageName: String -> appLauncher.openApp(packageName) }
        AsyncFunction("intentShareText") { text: String, targetPackage: String? ->
            shareLauncher.shareText(text, targetPackage)
        }
        AsyncFunction("intentShareFile") { fileUri: String, mimeType: String?, targetPackage: String? ->
            shareLauncher.shareFile(fileUri, mimeType, targetPackage)
        }
        AsyncFunction("intentComposeEmail") { to: String?, subject: String?, body: String? ->
            externalLauncher.composeEmail(to, subject, body)
        }
        AsyncFunction("intentOpenMap") { query: String?, latitude: Double?, longitude: Double? ->
            externalLauncher.openMap(query, latitude, longitude)
        }
        AsyncFunction("intentOpenDialer") { phoneNumber: String? ->
            externalLauncher.openDialer(phoneNumber)
        }

        // endregion

        // region Observer

        Function("watchSetting") { namespace: String, key: String ->
            requireKey(key)
            requireObserverManager().watch(SettingsNamespace.from(namespace), key)
        }

        Function("unwatchSetting") { subscriptionId: String ->
            requireObserverManager().unwatch(subscriptionId)
        }

        Function("unwatchAllSettings") {
            observerManager?.unwatchAll()
            Unit
        }

        // endregion
    }

    private fun requireKey(key: String) {
        if (key.isBlank()) throw InvalidArgumentException("Settings key must not be empty.")
    }

    private fun requireInRange(value: Int, min: Int, max: Int, name: String) {
        if (value < min || value > max) {
            throw InvalidArgumentException("$name must be within $min..$max, received $value.")
        }
    }

    private fun requireNonNegative(value: Int, name: String) {
        if (value < 0) throw InvalidArgumentException("$name must be >= 0, received $value.")
    }

    private fun brightnessFromPercent(percent: Int): Int =
        Math.round(percent / 100.0 * 255.0).toInt().coerceIn(0, 255)

    private fun percentFromBrightness(brightness: Int): Int =
        Math.round(brightness / 255.0 * 100.0).toInt().coerceIn(0, 100)
}
