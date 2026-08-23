package com.creepyim.voice

import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

/**
 * Text-to-speech on the platform engine.
 *
 * TextToSpeech is asynchronous to construct: nothing may be spoken until
 * onInit reports success, and a speak() before then is dropped with no error.
 * Calls made while initialising are therefore queued here and flushed on init
 * rather than lost, because the first thing an assistant says is usually
 * requested the moment the screen opens.
 */
class TextToSpeechModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    private var engine: TextToSpeech? = null

    @Volatile
    private var ready = false

    @Volatile
    private var initFailed = false

    /** Utterances requested before the engine finished starting. */
    private val pending = mutableListOf<Pair<String, String>>()

    /** Promises waiting on an utterance to finish, by utterance id. */
    private val awaiting = ConcurrentHashMap<String, Promise>()

    private var nextId = 0L

    private fun ensureEngine() {
        if (engine != null) return
        engine = TextToSpeech(reactContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                ready = true
                engine?.setOnUtteranceProgressListener(progress)
                synchronized(pending) {
                    pending.forEach { (id, text) -> enqueue(id, text) }
                    pending.clear()
                }
                emit(EVENT_READY, Arguments.createMap())
            } else {
                initFailed = true
                synchronized(pending) {
                    // Fail the waiting promises rather than leaving callers
                    // hanging on speech that will never happen.
                    pending.forEach { (id, _) ->
                        awaiting.remove(id)?.reject(
                            "TTS_INIT_FAILED",
                            "No usable text-to-speech engine is installed.",
                        )
                    }
                    pending.clear()
                }
                emit(EVENT_ERROR, Arguments.createMap().apply {
                    putString("code", "INIT_FAILED")
                    putString("message", "No usable text-to-speech engine is installed.")
                })
            }
        }
    }

    @ReactMethod
    fun isAvailable(promise: Promise) {
        ensureEngine()
        promise.resolve(!initFailed)
    }

    /**
     * Speak, resolving when the utterance finishes.
     *
     * QUEUE_FLUSH: an assistant saying two things at once is never wanted, and
     * a queued backlog means the user hears an answer to a question they have
     * already moved on from.
     */
    @ReactMethod
    fun speak(text: String, promise: Promise) {
        if (text.isBlank()) {
            promise.resolve(null)
            return
        }
        if (initFailed) {
            promise.reject("TTS_INIT_FAILED", "No usable text-to-speech engine is installed.")
            return
        }

        ensureEngine()
        val id = "utterance-${nextId++}"
        awaiting[id] = promise

        if (ready) {
            enqueue(id, text)
        } else {
            synchronized(pending) { pending.add(id to text) }
        }
    }

    private fun enqueue(id: String, text: String) {
        val result = engine?.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
        if (result != TextToSpeech.SUCCESS) {
            awaiting.remove(id)?.reject("TTS_SPEAK_FAILED", "The engine refused the utterance.")
        }
    }

    @ReactMethod
    fun stop() {
        engine?.stop()
        // Anything cut short resolves rather than rejects: stopping is a
        // normal control action, not a failure of the utterance.
        awaiting.keys.toList().forEach { awaiting.remove(it)?.resolve(null) }
    }

    /** 1.0 is the engine's normal speed; the platform clamps the extremes. */
    @ReactMethod
    fun setRate(rate: Double) {
        ensureEngine()
        engine?.setSpeechRate(rate.toFloat())
    }

    @ReactMethod
    fun setPitch(pitch: Double) {
        ensureEngine()
        engine?.setPitch(pitch.toFloat())
    }

    /**
     * Choose a language.
     *
     * Resolves false when the engine has no voice for it, instead of silently
     * speaking English in a Russian conversation.
     */
    @ReactMethod
    fun setLanguage(tag: String, promise: Promise) {
        ensureEngine()
        val locale = Locale.forLanguageTag(tag)
        val result = engine?.setLanguage(locale)
        val ok = result == TextToSpeech.LANG_AVAILABLE ||
            result == TextToSpeech.LANG_COUNTRY_AVAILABLE ||
            result == TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE
        promise.resolve(ok)
    }

    @ReactMethod
    fun getVoices(promise: Promise) {
        ensureEngine()
        val voices: WritableArray = Arguments.createArray()
        engine?.voices?.forEach { voice ->
            voices.pushMap(Arguments.createMap().apply {
                putString("name", voice.name)
                putString("language", voice.locale.toLanguageTag())
                putBoolean("networkRequired", voice.isNetworkConnectionRequired)
            })
        }
        promise.resolve(voices)
    }

    @ReactMethod
    fun addListener(eventName: String) = Unit

    @ReactMethod
    fun removeListeners(count: Double) = Unit

    override fun invalidate() {
        engine?.stop()
        engine?.shutdown()
        engine = null
        ready = false
        awaiting.keys.toList().forEach { awaiting.remove(it)?.resolve(null) }
        super.invalidate()
    }

    private val progress = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {
            emit(EVENT_START, Arguments.createMap().apply { putString("id", utteranceId) })
        }

        override fun onDone(utteranceId: String?) {
            utteranceId?.let { awaiting.remove(it)?.resolve(null) }
            emit(EVENT_DONE, Arguments.createMap().apply { putString("id", utteranceId) })
        }

        @Deprecated("Superseded by the error(String, Int) overload.")
        override fun onError(utteranceId: String?) {
            utteranceId?.let {
                awaiting.remove(it)?.reject("TTS_FAILED", "Speech failed.")
            }
            emit(EVENT_ERROR, Arguments.createMap().apply {
                putString("code", "SPEAK_FAILED")
                putString("id", utteranceId)
            })
        }

        override fun onStop(utteranceId: String?, interrupted: Boolean) {
            utteranceId?.let { awaiting.remove(it)?.resolve(null) }
        }
    }

    private fun emit(event: String, payload: com.facebook.react.bridge.WritableMap) {
        if (!reactContext.hasActiveReactInstance()) return
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, payload)
    }

    companion object {
        const val NAME = "CreepyTextToSpeech"
        const val EVENT_READY = "Tts.ready"
        const val EVENT_START = "Tts.start"
        const val EVENT_DONE = "Tts.done"
        const val EVENT_ERROR = "Tts.error"
    }
}
