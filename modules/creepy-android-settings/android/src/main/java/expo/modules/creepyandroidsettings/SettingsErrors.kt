package expo.modules.creepyandroidsettings

import expo.modules.kotlin.exception.CodedException

/**
 * The Android settings module is only available on Android. iOS/Web must never
 * reach these code paths, but the error code is kept consistent with the
 * TypeScript stubs for uniform client-side handling.
 */
class PlatformNotSupportedException(message: String) :
    CodedException("ERR_PLATFORM_NOT_SUPPORTED", message, null)

class InvalidArgumentException(message: String) :
    CodedException("ERR_INVALID_ARGUMENT", message, null)

class InvalidNamespaceException(value: String?) :
    CodedException(
        "ERR_INVALID_NAMESPACE",
        "Unknown settings namespace '$value'. Expected one of: system, secure, global.",
        null,
    )

class UnknownSettingsScreenException(screen: String) :
    CodedException("ERR_UNKNOWN_SETTINGS_SCREEN", "Unknown settings screen '$screen'.", null)

class SettingsScreenUnavailableException(screen: String, cause: Throwable? = null) :
    CodedException(
        "ERR_SETTINGS_SCREEN_UNAVAILABLE",
        "Settings screen '$screen' is not available on this device.",
        cause,
    )

class SettingsPanelUnavailableException(panel: String, cause: Throwable? = null) :
    CodedException(
        "ERR_SETTINGS_PANEL_UNAVAILABLE",
        "Settings panel '$panel' is not available on this device.",
        cause,
    )

class WriteSettingsPermissionRequiredException(key: String) :
    CodedException(
        "ERR_WRITE_SETTINGS_PERMISSION_REQUIRED",
        "WRITE_SETTINGS permission is required to update Settings.System.$key",
        null,
    )

class SettingReadFailedException(namespace: String, key: String, cause: Throwable? = null) :
    CodedException(
        "ERR_SETTING_READ_FAILED",
        "Failed to read Settings.$namespace.$key",
        cause,
    )

class SettingWriteFailedException(namespace: String, key: String, cause: Throwable? = null) :
    CodedException(
        "ERR_SETTING_WRITE_FAILED",
        "Failed to update Settings.$namespace.$key",
        cause,
    )

class ObserverNotFoundException(subscriptionId: String) :
    CodedException(
        "ERR_OBSERVER_NOT_FOUND",
        "No observer registered for subscription id '$subscriptionId'.",
        null,
    )

class AndroidContextUnavailableException :
    CodedException(
        "ERR_ANDROID_CONTEXT_UNAVAILABLE",
        "Android context is unavailable.",
        null,
    )
