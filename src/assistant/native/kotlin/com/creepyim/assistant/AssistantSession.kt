package com.creepyim.assistant

import android.app.assist.AssistContent
import android.app.assist.AssistStructure
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.service.voice.VoiceInteractionSession
import android.util.Log

/**
 * One assistant invocation.
 *
 * The platform creates a session each time the assistant is summoned — by the
 * gesture, the power button, the lock screen, or the app itself — and destroys
 * it when the session hides. Everything here therefore has to assume it may
 * run with the app's JS runtime not started at all.
 *
 * The session captures context and hands off to the app's own UI rather than
 * rendering the assistant experience itself. That is a deliberate first step,
 * not the end state: the session window is the right place for a real overlay
 * assistant (guide §31), but building that means running React Native inside a
 * session-owned window, which is a much larger change than making the role
 * work. The hand-off proves the whole chain end to end first.
 */
class AssistantSession(context: Context) : VoiceInteractionSession(context) {

    private var handledContext = false

    override fun onShow(args: Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
        handledContext = false
        lastShowSource = showFlags
    }

    /*
     * Only the deprecated three-argument form is overridden, and on purpose.
     * The API 29 replacement, onHandleAssist(AssistState), delegates to this
     * one by default, so overriding this alone covers minSdk 24 through 36 —
     * whereas overriding the newer form would name a class that does not exist
     * on the older devices this app still supports.
     */
    @Deprecated("Platform delegates the AssistState overload to this one.")
    @Suppress("OVERRIDE_DEPRECATION")
    override fun onHandleAssist(
        data: Bundle?,
        structure: AssistStructure?,
        content: AssistContent?,
    ) {
        try {
            val extracted = ScreenContextExtractor.extract(structure, content)
            extracted.put("showSource", describeSource(lastShowSource))
            ScreenContextStore.put(extracted)
            handledContext = true
        } catch (error: Throwable) {
            // Never let a malformed structure take down the assistant: the
            // session still has to open, just without screen context.
            Log.w(TAG, "could not extract assist context", error)
            ScreenContextStore.clear()
        }
        handOff()
    }

    /**
     * The screenshot is acknowledged but not retained.
     *
     * Holding a full-screen bitmap in a process-wide store is both a memory
     * cost and a standing copy of whatever the user last had open. Image
     * understanding is a later phase and will need an explicit user action to
     * pass a screenshot anywhere; until that exists, recording that one was
     * offered is all that is useful.
     */
    override fun onHandleScreenshot(screenshot: Bitmap?) {
        screenshotAvailable = screenshot != null
    }

    override fun onHide() {
        // The session is going away; a later invocation captures afresh.
        super.onHide()
    }

    /**
     * Opens the app on the assist route.
     *
     * FLAG_ACTIVITY_NEW_TASK is required — a session has no activity task of
     * its own. The session then hides so the user is not left with an empty
     * assistant window behind the app.
     */
    private fun handOff() {
        val intent = Intent(Intent.ACTION_VIEW).apply {
            data = android.net.Uri.parse(ASSIST_URI)
            setPackage(context.packageName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            putExtra(EXTRA_HAS_CONTEXT, handledContext)
        }
        try {
            startAssistantActivity(intent)
        } catch (error: Throwable) {
            // Some OEM builds refuse startAssistantActivity from a session
            // that was shown without assist flags. A plain activity start is
            // the honest fallback; it loses the assistant window transition
            // but still gets the user where they asked to go.
            Log.w(TAG, "startAssistantActivity refused, falling back", error)
            try {
                context.startActivity(intent)
            } catch (fallbackError: Throwable) {
                Log.e(TAG, "could not open the assistant UI", fallbackError)
            }
        }
        hide()
    }

    private fun describeSource(flags: Int): String = when {
        flags and SHOW_SOURCE_ASSIST_GESTURE != 0 -> "assist_gesture"
        flags and SHOW_SOURCE_PUSH_TO_TALK != 0 -> "push_to_talk"
        flags and SHOW_SOURCE_NOTIFICATION != 0 -> "notification"
        flags and SHOW_SOURCE_ACTIVITY != 0 -> "activity"
        flags and SHOW_SOURCE_APPLICATION != 0 -> "application"
        flags and SHOW_SOURCE_AUTOMOTIVE_SYSTEM_UI != 0 -> "automotive"
        else -> "unknown"
    }

    companion object {
        private const val TAG = "AssistantSession"

        /** Deep link the app resolves to its assistant screen. */
        const val ASSIST_URI = "creepyim://assist"
        const val EXTRA_HAS_CONTEXT = "com.creepyim.assistant.HAS_CONTEXT"

        @Volatile
        private var lastShowSource: Int = 0

        @Volatile
        var screenshotAvailable: Boolean = false
            private set
    }
}
