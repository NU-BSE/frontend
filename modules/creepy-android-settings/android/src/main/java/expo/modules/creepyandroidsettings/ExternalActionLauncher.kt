package expo.modules.creepyandroidsettings

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri

/** Safe, allow-listed external intents used by navigation/composer MCP tools. */
class ExternalActionLauncher(private val context: Context) {
    private val allowedSchemes = setOf("http", "https", "mailto", "tel", "geo")

    fun openUri(uri: String): Boolean {
        val parsed = Uri.parse(uri.trim())
        val scheme = parsed.scheme?.lowercase()
        if (scheme.isNullOrBlank() || scheme !in allowedSchemes) {
            throw InvalidArgumentException(
                "uri must use one of: ${allowedSchemes.joinToString(", ")}.",
            )
        }
        return start(Intent(Intent.ACTION_VIEW, parsed))
    }

    fun composeEmail(to: String?, subject: String?, body: String?): Boolean {
        val address = to?.trim().orEmpty()
        val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:${Uri.encode(address)}"))
        if (!subject.isNullOrEmpty()) intent.putExtra(Intent.EXTRA_SUBJECT, subject)
        if (!body.isNullOrEmpty()) intent.putExtra(Intent.EXTRA_TEXT, body)
        return start(intent)
    }

    fun openMap(query: String?, latitude: Double?, longitude: Double?): Boolean {
        if ((latitude == null) != (longitude == null)) {
            throw InvalidArgumentException("latitude and longitude must be supplied together.")
        }
        val trimmedQuery = query?.trim()?.takeIf { it.isNotEmpty() }
        val uri = when {
            latitude != null && longitude != null && trimmedQuery != null ->
                Uri.parse(
                    "geo:$latitude,$longitude?q=${Uri.encode("$latitude,$longitude($trimmedQuery)")}",
                )
            latitude != null && longitude != null -> Uri.parse("geo:$latitude,$longitude")
            trimmedQuery != null -> Uri.parse("geo:0,0?q=${Uri.encode(trimmedQuery)}")
            else -> throw InvalidArgumentException(
                "openMap requires a query or latitude/longitude.",
            )
        }
        return start(Intent(Intent.ACTION_VIEW, uri))
    }

    fun openDialer(phoneNumber: String?): Boolean {
        val number = phoneNumber?.trim().orEmpty()
        return start(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${Uri.encode(number)}")))
    }

    private fun start(intent: Intent): Boolean = try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (_: ActivityNotFoundException) {
        false
    } catch (_: SecurityException) {
        false
    }
}
