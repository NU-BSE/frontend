package expo.modules.creepyandroidsettings

import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import java.util.Locale

/**
 * PackageManager-backed app lookup that stays within Android package-visibility
 * rules. The manifest declares only the launcher intent query; this module does
 * not request QUERY_ALL_PACKAGES.
 */
class AppManager(private val packageManager: PackageManager) {

    fun findApps(query: String, limit: Int): List<Map<String, Any?>> {
        val normalized = query.trim().lowercase(Locale.ROOT)
        val boundedLimit = limit.coerceIn(1, 50)
        val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)

        return queryLauncherActivities(launcherIntent)
            .asSequence()
            .mapNotNull { resolveInfo ->
                val appInfo = resolveInfo.activityInfo?.applicationInfo ?: return@mapNotNull null
                val packageName = appInfo.packageName ?: return@mapNotNull null
                val label = resolveInfo.loadLabel(packageManager)?.toString()?.trim().orEmpty()
                if (
                    normalized.isNotEmpty() &&
                    !label.lowercase(Locale.ROOT).contains(normalized) &&
                    !packageName.lowercase(Locale.ROOT).contains(normalized)
                ) {
                    return@mapNotNull null
                }

                mapOf(
                    "packageName" to packageName,
                    "label" to (label.ifEmpty { packageName }),
                    "enabled" to appInfo.enabled,
                    "systemApp" to isSystemApp(appInfo),
                    "launchable" to true,
                )
            }
            .distinctBy { it["packageName"] as String }
            .sortedBy { (it["label"] as String).lowercase(Locale.ROOT) }
            .take(boundedLimit)
            .toList()
    }

    fun getAppInfo(packageName: String): Map<String, Any?>? {
        if (packageName.isBlank()) throw InvalidArgumentException("packageName must not be empty.")

        val appInfo = try {
            getApplicationInfo(packageName)
        } catch (_: PackageManager.NameNotFoundException) {
            return null
        }

        val packageInfo = try {
            getPackageInfo(packageName)
        } catch (_: PackageManager.NameNotFoundException) {
            null
        }

        val label = packageManager.getApplicationLabel(appInfo)?.toString()?.trim().orEmpty()
        val versionCode = packageInfo?.let {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                it.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                it.versionCode.toLong()
            }
        }

        return mapOf(
            "packageName" to packageName,
            "label" to (label.ifEmpty { packageName }),
            "versionName" to packageInfo?.versionName,
            "versionCode" to versionCode,
            "enabled" to appInfo.enabled,
            "systemApp" to isSystemApp(appInfo),
            "launchable" to (packageManager.getLaunchIntentForPackage(packageName) != null),
        )
    }

    private fun isSystemApp(info: ApplicationInfo): Boolean =
        (info.flags and ApplicationInfo.FLAG_SYSTEM) != 0 ||
            (info.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0

    private fun queryLauncherActivities(intent: Intent) =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packageManager.queryIntentActivities(
                intent,
                PackageManager.ResolveInfoFlags.of(0),
            )
        } else {
            @Suppress("DEPRECATION")
            packageManager.queryIntentActivities(intent, 0)
        }

    private fun getApplicationInfo(packageName: String): ApplicationInfo =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packageManager.getApplicationInfo(
                packageName,
                PackageManager.ApplicationInfoFlags.of(0),
            )
        } else {
            @Suppress("DEPRECATION")
            packageManager.getApplicationInfo(packageName, 0)
        }

    private fun getPackageInfo(packageName: String) =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packageManager.getPackageInfo(
                packageName,
                PackageManager.PackageInfoFlags.of(0),
            )
        } else {
            @Suppress("DEPRECATION")
            packageManager.getPackageInfo(packageName, 0)
        }
}
