package com.creepyim.assistant

import android.app.Activity
import android.app.role.RoleManager
import android.content.Intent
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * The assistant role and the captured screen context, exposed to JavaScript.
 *
 * Reached from JS through NativeModules rather than TurboModuleRegistry: this
 * project has no codegenConfig, so nothing here is a real TurboModule and the
 * registry would not find it. See src/specs/NativeAssistant.ts.
 */
class AssistantRoleModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    private var pendingRoleRequest: Promise? = null

    private val activityListener: ActivityEventListener =
        object : BaseActivityEventListener() {
            override fun onActivityResult(
                activity: Activity,
                requestCode: Int,
                resultCode: Int,
                data: Intent?,
            ) {
                if (requestCode != REQUEST_ASSISTANT) return
                val promise = pendingRoleRequest ?: return
                pendingRoleRequest = null
                /*
                 * RESULT_OK means the user accepted the role dialog. It is not
                 * proof the role is held — on some builds the grant lands a
                 * moment later — so the answer is re-read rather than assumed
                 * from the result code.
                 */
                promise.resolve(isRoleHeld())
            }
        }

    init {
        reactContext.addActivityEventListener(activityListener)
    }

    override fun invalidate() {
        reactContext.removeActivityEventListener(activityListener)
        pendingRoleRequest?.reject("ASSISTANT_CANCELLED", "The module was torn down.")
        pendingRoleRequest = null
        super.invalidate()
    }

    /** Whether this device exposes the assistant role at all. */
    @ReactMethod
    fun isRoleAvailable(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // Before API 29 there is no RoleManager. The assistant can still
            // be chosen by the user in system settings, so this reports the
            // honest answer: the role API is unavailable, not the capability.
            promise.resolve(false)
            return
        }
        val manager = reactContext.getSystemService(RoleManager::class.java)
        promise.resolve(manager?.isRoleAvailable(RoleManager.ROLE_ASSISTANT) == true)
    }

    @ReactMethod
    fun isDefaultAssistant(promise: Promise) {
        promise.resolve(isRoleHeld())
    }

    /**
     * Asks the user to make Creepy the device assistant.
     *
     * Resolves true only if the role is actually held afterwards. Declining is
     * a normal outcome and resolves false rather than rejecting — a refusal is
     * an answer, not a failure.
     */
    @ReactMethod
    fun requestAssistantRole(promise: Promise) {
        if (isRoleHeld()) {
            promise.resolve(true)
            return
        }

        val activity = reactContext.currentActivity
        if (activity == null) {
            promise.reject(
                "ASSISTANT_NO_ACTIVITY",
                "The role dialog needs a foreground activity to attach to.",
            )
            return
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // No RoleManager: send the user to Default apps when Android has
            // that public destination. It cannot report back, so this resolves
            // false and the caller re-checks when the app returns.
            openAssistSettings(activity)
            promise.resolve(false)
            return
        }

        val manager = reactContext.getSystemService(RoleManager::class.java)
        if (manager == null || !manager.isRoleAvailable(RoleManager.ROLE_ASSISTANT)) {
            promise.reject(
                "ASSISTANT_ROLE_UNAVAILABLE",
                "This device does not offer the assistant role.",
            )
            return
        }

        if (pendingRoleRequest != null) {
            promise.reject(
                "ASSISTANT_REQUEST_IN_FLIGHT",
                "A role request is already open.",
            )
            return
        }

        pendingRoleRequest = promise
        try {
            activity.startActivityForResult(
                manager.createRequestRoleIntent(RoleManager.ROLE_ASSISTANT),
                REQUEST_ASSISTANT,
            )
        } catch (error: Throwable) {
            pendingRoleRequest = null
            promise.reject("ASSISTANT_REQUEST_FAILED", error.message, error)
        }
    }

    /** Opens the public Default apps screen where the assistant can be chosen. */
    @ReactMethod
    fun openAssistantSettings(promise: Promise) {
        val activity = reactContext.currentActivity
        if (activity == null) {
            promise.reject("ASSISTANT_NO_ACTIVITY", "No foreground activity.")
            return
        }
        promise.resolve(openAssistSettings(activity))
    }

    /**
     * The screen context captured by the most recent invocation, as JSON.
     *
     * Null when the assistant has not been invoked, when the user has turned
     * off sending screen content to the assistant, or when the capture has
     * aged out. All three are ordinary states, so the caller must handle null
     * rather than treat it as an error.
     */
    @ReactMethod
    fun getAssistContext(promise: Promise) {
        promise.resolve(ScreenContextStore.take())
    }

    @ReactMethod
    fun clearAssistContext() {
        ScreenContextStore.clear()
    }

    /** Whether the platform has bound the voice interaction service. */
    @ReactMethod
    fun isAssistantServiceReady(promise: Promise) {
        promise.resolve(AssistantVoiceService.isReady)
    }

    private fun isRoleHeld(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val manager = reactContext.getSystemService(RoleManager::class.java) ?: return false
            if (!manager.isRoleAvailable(RoleManager.ROLE_ASSISTANT)) return false
            return manager.isRoleHeld(RoleManager.ROLE_ASSISTANT)
        }
        /*
         * Pre-29 fallback: the chosen assistant is recorded in Secure settings
         * as a flattened component name. Reading it is the only way to answer
         * without RoleManager, and an empty value means the user has chosen no
         * assistant at all.
         */
        val selected = Settings.Secure.getString(
            reactContext.contentResolver,
            SETTINGS_ASSISTANT,
        )
        return selected?.startsWith(reactContext.packageName) == true
    }

    private fun openAssistSettings(activity: Activity): Boolean = try {
        val action = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS
        } else {
            Settings.ACTION_APPLICATION_SETTINGS
        }
        activity.startActivity(
            Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        true
    } catch (error: Throwable) {
        false
    }

    companion object {
        const val NAME = "AssistantRole"
        private const val REQUEST_ASSISTANT = 5150

        /** Settings.Secure.ASSISTANT — public as a string, not as a constant. */
        private const val SETTINGS_ASSISTANT = "assistant"
    }
}
