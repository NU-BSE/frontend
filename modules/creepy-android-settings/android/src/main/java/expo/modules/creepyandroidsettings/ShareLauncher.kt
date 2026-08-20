package expo.modules.creepyandroidsettings

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri

/** Android Sharesheet bridge with optional package targeting. */
class ShareLauncher(private val context: Context) {
    fun shareText(text: String, targetPackage: String?): Boolean {
        if (text.isEmpty()) throw InvalidArgumentException("text must not be empty.")
        val send = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, text)
        if (!targetPackage.isNullOrBlank()) send.setPackage(targetPackage)
        return start(if (targetPackage.isNullOrBlank()) Intent.createChooser(send, null) else send)
    }

    fun shareFile(fileUri: String, mimeType: String?, targetPackage: String?): Boolean {
        val uri = Uri.parse(fileUri.trim())
        if (uri.scheme != "content" && uri.scheme != "android.resource") {
            throw InvalidArgumentException(
                "shareFile requires a content:// or android.resource:// URI.",
            )
        }
        val send = Intent(Intent.ACTION_SEND)
            .setType(mimeType?.takeIf { it.isNotBlank() } ?: "*/*")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (!targetPackage.isNullOrBlank()) send.setPackage(targetPackage)
        return start(if (targetPackage.isNullOrBlank()) Intent.createChooser(send, null) else send)
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
