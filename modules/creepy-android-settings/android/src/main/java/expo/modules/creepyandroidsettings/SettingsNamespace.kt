package expo.modules.creepyandroidsettings

/**
 * The three namespaces exposed by [android.provider.Settings].
 *
 * `SYSTEM` is user-writable (subject to WRITE_SETTINGS); `SECURE` and `GLOBAL`
 * are read-only for ordinary apps and must never be exposed for generic writes.
 */
enum class SettingsNamespace(val value: String) {
    SYSTEM("system"),
    SECURE("secure"),
    GLOBAL("global");

    companion object {
        fun from(value: String?): SettingsNamespace =
            entries.firstOrNull { it.value == value }
                ?: throw InvalidNamespaceException(value)
    }
}
