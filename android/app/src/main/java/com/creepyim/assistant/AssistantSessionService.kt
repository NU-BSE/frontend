package com.creepyim.assistant

import android.os.Bundle
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService

/**
 * Creates a session per invocation.
 *
 * Separate from AssistantVoiceService by platform design: the voice service is
 * bound for as long as the assistant role is held, while this one is started
 * only when the assistant is actually summoned. Keeping the work on this side
 * of the split is what stops an idle assistant from costing anything.
 */
class AssistantSessionService : VoiceInteractionSessionService() {
    override fun onNewSession(args: Bundle?): VoiceInteractionSession =
        AssistantSession(this)
}
