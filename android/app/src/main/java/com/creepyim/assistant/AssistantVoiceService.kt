package com.creepyim.assistant

import android.os.Bundle
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession

/**
 * The assistant runtime the platform binds to once Creepy holds ROLE_ASSISTANT.
 *
 * Deliberately almost empty. This service is bound for the lifetime of the
 * assistant role — not just while a session is open — so anything expensive
 * here is resident for as long as the user has Creepy selected. The work
 * belongs in the session (see AssistantSessionService).
 */
class AssistantVoiceService : VoiceInteractionService() {

    override fun onReady() {
        super.onReady()
        isReady = true
    }

    override fun onShutdown() {
        isReady = false
        super.onShutdown()
    }

    /**
     * Opens the assistant from inside the app.
     *
     * The two flags are what make the platform gather context: without
     * SHOW_WITH_ASSIST no AssistStructure arrives, and without
     * SHOW_WITH_SCREENSHOT onHandleScreenshot is never called. The user's own
     * "send screen content to the assistant" setting still overrides both, so
     * a session must treat missing context as normal rather than as an error.
     */
    fun openAssistant(args: Bundle = Bundle()) {
        showSession(
            args,
            VoiceInteractionSession.SHOW_WITH_ASSIST or
                VoiceInteractionSession.SHOW_WITH_SCREENSHOT,
        )
    }

    companion object {
        /**
         * Whether the platform has bound this service.
         *
         * Holding the role and being bound are different states: the bind
         * happens asynchronously after the role is granted, and showSession
         * from an unbound service throws.
         */
        @Volatile
        var isReady: Boolean = false
            private set
    }
}
