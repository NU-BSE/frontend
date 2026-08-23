package com.creepyim.assistant

import android.speech.RecognitionService

/**
 * A recognition service that recognises nothing.
 *
 * voice_interaction_service.xml must name a recognitionService, and the named
 * component has to exist or the whole voice interaction service is rejected.
 * Speech recognition itself is a later phase and will use the platform's
 * SpeechRecognizer rather than this component, so every callback here reports
 * that it did nothing instead of pretending to listen.
 */
class AssistantRecognitionService : RecognitionService() {

    override fun onStartListening(recognizerIntent: android.content.Intent?, listener: Callback?) {
        // ERROR_CLIENT rather than silence: a caller that bound to this
        // expecting results should fail fast and visibly.
        listener?.error(android.speech.SpeechRecognizer.ERROR_CLIENT)
    }

    override fun onCancel(listener: Callback?) = Unit

    override fun onStopListening(listener: Callback?) = Unit
}
