package com.creepyim.voice

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener

/**
 * Speech-to-text on the platform recogniser.
 *
 * SpeechRecognizer is main-thread-only — every call must be posted to the UI
 * thread or it throws, and the failure looks like the recogniser silently
 * never starting. It is also single-shot: one utterance per start, ending in
 * exactly one of onResults or onError, which is why the JS side gets discrete
 * events rather than a stream to poll.
 *
 * Audio never crosses the bridge. Only transcripts do, which keeps the JS
 * runtime out of the real-time path entirely (guide §4).
 */
class SpeechRecognitionModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    /** Touched only on the main thread; see the note on the class. */
    private var recognizer: SpeechRecognizer? = null
    private var listening = false

    @ReactMethod
    fun isAvailable(promise: Promise) {
        promise.resolve(SpeechRecognizer.isRecognitionAvailable(reactContext))
    }

    /**
     * Whether the device can transcribe without a network round trip.
     *
     * Worth knowing rather than assuming: stock Android usually recognises via
     * Google's servers, so "on device" is the exception. Below API 31 there is
     * no on-device recogniser API at all.
     */
    @ReactMethod
    fun isOnDeviceRecognitionAvailable(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            promise.resolve(false)
            return
        }
        promise.resolve(SpeechRecognizer.isOnDeviceRecognitionAvailable(reactContext))
    }

    @ReactMethod
    fun hasPermission(promise: Promise) {
        promise.resolve(micGranted())
    }

    @ReactMethod
    fun requestPermission(promise: Promise) {
        if (micGranted()) {
            promise.resolve(true)
            return
        }
        val activity = reactContext.currentActivity
        if (activity !is PermissionAwareActivity) {
            // No foreground activity to host the dialog. Reporting the current
            // state is honest; pretending to have asked is not.
            promise.resolve(false)
            return
        }
        val listener = PermissionListener { requestCode, permissions, grantResults ->
            if (requestCode != PERMISSION_REQUEST_CODE) return@PermissionListener false
            val granted = permissions.indexOf(Manifest.permission.RECORD_AUDIO)
                .takeIf { it >= 0 }
                ?.let { grantResults.getOrNull(it) == PackageManager.PERMISSION_GRANTED }
                ?: false
            promise.resolve(granted)
            true
        }
        activity.requestPermissions(
            arrayOf(Manifest.permission.RECORD_AUDIO),
            PERMISSION_REQUEST_CODE,
            listener,
        )
    }

    /**
     * Begin listening for one utterance.
     *
     * `preferOffline` is a request, not a guarantee: the platform falls back to
     * network recognition when it has no local model for the language, and
     * gives no signal that it did.
     */
    @ReactMethod
    fun startListening(language: String?, preferOffline: Boolean, promise: Promise) {
        if (!micGranted()) {
            promise.reject("VOICE_NO_PERMISSION", "Microphone permission has not been granted.")
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(reactContext)) {
            promise.reject(
                "VOICE_UNAVAILABLE",
                "This device has no speech recogniser installed.",
            )
            return
        }

        runOnMain {
            try {
                if (listening) {
                    // Restarting mid-utterance loses the partial transcript and
                    // is almost always a double-tap rather than an intent.
                    promise.reject("VOICE_BUSY", "Already listening.")
                    return@runOnMain
                }

                recognizer?.destroy()
                val created = SpeechRecognizer.createSpeechRecognizer(reactContext)
                created.setRecognitionListener(listener)
                recognizer = created

                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(
                        RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                        RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
                    )
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, MAX_RESULTS)
                    language?.let { putExtra(RecognizerIntent.EXTRA_LANGUAGE, it) }
                    if (preferOffline && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                    }
                }

                listening = true
                created.startListening(intent)
                promise.resolve(null)
            } catch (error: Throwable) {
                listening = false
                promise.reject("VOICE_START_FAILED", error.message, error)
            }
        }
    }

    /** Stop capturing and transcribe what was heard so far. */
    @ReactMethod
    fun stopListening() {
        runOnMain {
            recognizer?.stopListening()
        }
    }

    /** Abandon the utterance; no result is emitted. */
    @ReactMethod
    fun cancel() {
        runOnMain {
            listening = false
            recognizer?.cancel()
        }
    }

    @ReactMethod
    fun destroy() {
        runOnMain {
            listening = false
            recognizer?.destroy()
            recognizer = null
        }
    }

    /** Required by the event emitter contract; the listeners live in JS. */
    @ReactMethod
    fun addListener(eventName: String) = Unit

    @ReactMethod
    fun removeListeners(count: Double) = Unit

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) = emit(EVENT_READY, Arguments.createMap())

        override fun onBeginningOfSpeech() = emit(EVENT_SPEECH_START, Arguments.createMap())

        override fun onRmsChanged(rmsdB: Float) {
            /*
             * Deliberately not forwarded. This fires many times a second, and
             * turning every frame into a bridge message is exactly the
             * real-time traffic the audio pipeline is kept native to avoid. A
             * level meter should be drawn natively if one is ever wanted.
             */
        }

        override fun onBufferReceived(buffer: ByteArray?) = Unit

        override fun onEndOfSpeech() = emit(EVENT_SPEECH_END, Arguments.createMap())

        override fun onError(error: Int) {
            listening = false
            val payload = Arguments.createMap().apply {
                putString("code", errorCode(error))
                putString("message", errorMessage(error))
            }
            emit(EVENT_ERROR, payload)
        }

        override fun onResults(results: Bundle?) {
            listening = false
            emit(EVENT_RESULT, transcriptPayload(results, isFinal = true))
        }

        override fun onPartialResults(partialResults: Bundle?) {
            emit(EVENT_PARTIAL, transcriptPayload(partialResults, isFinal = false))
        }

        override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }

    private fun transcriptPayload(results: Bundle?, isFinal: Boolean): WritableMap {
        val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        val alternatives = Arguments.createArray()
        matches?.forEach { alternatives.pushString(it) }
        return Arguments.createMap().apply {
            putString("transcript", matches?.firstOrNull() ?: "")
            putArray("alternatives", alternatives)
            putBoolean("isFinal", isFinal)
        }
    }

    private fun micGranted(): Boolean =
        ContextCompat.checkSelfPermission(
            reactContext,
            Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED

    private fun runOnMain(block: () -> Unit) {
        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) block()
        else android.os.Handler(android.os.Looper.getMainLooper()).post(block)
    }

    private fun emit(event: String, payload: WritableMap) {
        if (!reactContext.hasActiveReactInstance()) return
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, payload)
    }

    /**
     * Error codes as names.
     *
     * The integers are meaningless to JS and, more importantly, these are not
     * all failures: NO_MATCH and SPEECH_TIMEOUT mean the user said nothing,
     * which a caller should handle as "try again", not as a broken recogniser.
     */
    private fun errorCode(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_AUDIO -> "AUDIO"
        SpeechRecognizer.ERROR_CLIENT -> "CLIENT"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "PERMISSION"
        SpeechRecognizer.ERROR_NETWORK -> "NETWORK"
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "NETWORK_TIMEOUT"
        SpeechRecognizer.ERROR_NO_MATCH -> "NO_MATCH"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "BUSY"
        SpeechRecognizer.ERROR_SERVER -> "SERVER"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "SPEECH_TIMEOUT"
        else -> "UNKNOWN"
    }

    private fun errorMessage(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_AUDIO -> "The microphone could not be read."
        SpeechRecognizer.ERROR_CLIENT -> "The recogniser rejected the request."
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is missing."
        SpeechRecognizer.ERROR_NETWORK -> "Recognition needs a network connection."
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "The recognition server did not respond."
        SpeechRecognizer.ERROR_NO_MATCH -> "Nothing was recognised."
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "The recogniser is busy."
        SpeechRecognizer.ERROR_SERVER -> "The recognition server returned an error."
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech was heard."
        else -> "Recognition failed."
    }

    companion object {
        const val NAME = "SpeechRecognition"
        private const val PERMISSION_REQUEST_CODE = 5151
        private const val MAX_RESULTS = 3

        const val EVENT_READY = "Voice.ready"
        const val EVENT_SPEECH_START = "Voice.speechStart"
        const val EVENT_SPEECH_END = "Voice.speechEnd"
        const val EVENT_PARTIAL = "Voice.partial"
        const val EVENT_RESULT = "Voice.result"
        const val EVENT_ERROR = "Voice.error"
    }
}
