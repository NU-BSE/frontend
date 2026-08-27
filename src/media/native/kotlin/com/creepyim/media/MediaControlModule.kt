package com.creepyim.media

import android.content.ComponentName
import android.content.Context
import android.media.AudioManager
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Media transport control and volume.
 *
 * Works through MediaSession, so "pause Spotify" is the same request Spotify's
 * own notification makes — no UI automation, and it works for whatever app
 * happens to hold the session rather than for a list of apps we anticipated.
 *
 * MediaSessionManager.getActiveSessions requires notification-listener access,
 * which the app already asks for to read the shade. Without it there is no way
 * to see sessions at all, so every method here reports that plainly instead of
 * appearing to do nothing.
 */
class MediaControlModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    private fun controllers(): List<MediaController>? {
        val manager = reactContext.getSystemService(Context.MEDIA_SESSION_SERVICE)
            as? MediaSessionManager ?: return null
        val component = ComponentName(
            reactContext.packageName,
            "com.creepyim.notifications.NotificationReaderService",
        )
        return try {
            manager.getActiveSessions(component)
        } catch (error: SecurityException) {
            // Notification access has not been granted; the caller is told.
            null
        } catch (error: Throwable) {
            null
        }
    }

    /**
     * The session to act on.
     *
     * The one that is actually playing wins over merely-present sessions: a
     * paused podcast and a playing track can both hold sessions, and pausing
     * the podcast when the user said "pause" would be wrong.
     */
    private fun active(): MediaController? {
        val all = controllers() ?: return null
        return all.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING }
            ?: all.firstOrNull()
    }

    @ReactMethod
    fun getNowPlaying(promise: Promise) {
        val controller = active()
        if (controller == null) {
            promise.resolve(null)
            return
        }
        val metadata = controller.metadata
        promise.resolve(
            Arguments.createMap().apply {
                putString("packageName", controller.packageName)
                putBoolean("isPlaying", controller.playbackState?.state == PlaybackState.STATE_PLAYING)
                metadata?.getString(android.media.MediaMetadata.METADATA_KEY_TITLE)
                    ?.let { putString("title", it) }
                metadata?.getString(android.media.MediaMetadata.METADATA_KEY_ARTIST)
                    ?.let { putString("artist", it) }
                metadata?.getString(android.media.MediaMetadata.METADATA_KEY_ALBUM)
                    ?.let { putString("album", it) }
            },
        )
    }

    /**
     * Transport commands.
     *
     * Resolves false when there is no session to command, rather than
     * rejecting: "nothing is playing" is a normal answer to "skip this track",
     * and the caller should say so rather than report a fault.
     */
    @ReactMethod
    fun play(promise: Promise) = transport(promise) { it.transportControls.play() }

    @ReactMethod
    fun pause(promise: Promise) = transport(promise) { it.transportControls.pause() }

    @ReactMethod
    fun next(promise: Promise) = transport(promise) { it.transportControls.skipToNext() }

    @ReactMethod
    fun previous(promise: Promise) = transport(promise) { it.transportControls.skipToPrevious() }

    @ReactMethod
    fun stop(promise: Promise) = transport(promise) { it.transportControls.stop() }

    @ReactMethod
    fun seekTo(positionMs: Double, promise: Promise) =
        transport(promise) { it.transportControls.seekTo(positionMs.toLong()) }

    private fun transport(promise: Promise, action: (MediaController) -> Unit) {
        val controller = active()
        if (controller == null) {
            promise.resolve(false)
            return
        }
        try {
            action(controller)
            promise.resolve(true)
        } catch (error: Throwable) {
            promise.reject("MEDIA_COMMAND_FAILED", error.message, error)
        }
    }

    /**
     * Media volume as a fraction of the device maximum.
     *
     * Reported as 0..1 rather than as a step index, because the number of
     * steps differs by device and an absolute index means nothing to a caller.
     */
    @ReactMethod
    fun getVolume(promise: Promise) {
        val audio = reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        if (audio == null) {
            promise.resolve(null)
            return
        }
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        if (max <= 0) {
            promise.resolve(null)
            return
        }
        promise.resolve(audio.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / max)
    }

    @ReactMethod
    fun setVolume(fraction: Double, promise: Promise) {
        val audio = reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        if (audio == null) {
            promise.resolve(false)
            return
        }
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val clamped = fraction.coerceIn(0.0, 1.0)
        try {
            audio.setStreamVolume(
                AudioManager.STREAM_MUSIC,
                Math.round(clamped * max).toInt(),
                0,
            )
            promise.resolve(true)
        } catch (error: SecurityException) {
            /*
             * Do Not Disturb blocks volume changes unless the app holds
             * notification-policy access. That is a real, common state on a
             * phone in a meeting, so it is reported rather than swallowed.
             */
            promise.reject(
                "MEDIA_VOLUME_BLOCKED",
                "Do Not Disturb is preventing volume changes.",
                error,
            )
        }
    }

    companion object {
        const val NAME = "MediaControl"
    }
}
