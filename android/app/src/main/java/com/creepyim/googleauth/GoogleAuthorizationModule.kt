package com.creepyim.googleauth

import android.accounts.Account
import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.ClearTokenRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.auth.api.identity.RevokeAccessRequest
import com.google.android.gms.common.api.Scope
import java.util.concurrent.atomic.AtomicInteger
import android.util.Log
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes

/**
 * Google Identity authorization bridge backed by Google Play Services
 * AuthorizationClient.
 *
 * authorize() may launch Google's consent/account selection UI.
 *
 * getAccessToken() is intentionally silent: if Google requires user
 * interaction, RECONNECT_REQUIRED is returned instead of launching an
 * Activity from a background MCP execution.
 */
class GoogleAuthorizationModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    override fun getName(): String = "GoogleAuthorizationModule"

    private val nextRequestCode = AtomicInteger(0x5000)

    private val pendingResolutions =
        HashMap<Int, Promise>()

    init {
        reactContext.addActivityEventListener(this)
    }

    private fun scopes(readable: ReadableArray): List<Scope> {
        val result = ArrayList<Scope>(readable.size())

        for (i in 0 until readable.size()) {
            val scopeUri = readable.getString(i) ?: continue

            if (scopeUri.isNotBlank()) {
                result.add(Scope(scopeUri))
            }
        }

        return result
    }

    private fun buildRequest(
        requestedScopes: List<Scope>,
        accountName: String?,
        selectAccount: Boolean,
    ): AuthorizationRequest {
        val builder = AuthorizationRequest.builder()
            .setRequestedScopes(requestedScopes)

        if (!accountName.isNullOrBlank()) {
            builder.setAccount(
                Account(
                    accountName,
                    "com.google",
                ),
            )
        }

        if (selectAccount) {
            builder.setPrompt(
                AuthorizationRequest.Prompt.SELECT_ACCOUNT,
            )
        }

        return builder.build()
    }

    private fun resolveResult(
        result: AuthorizationResult,
        promise: Promise,
    ) {
        val map = WritableNativeMap()

        map.putString(
            "accessToken",
            result.accessToken ?: "",
        )

        val grantedScopes = WritableNativeArray()

        result.grantedScopes.forEach { scope ->
            grantedScopes.pushString(scope)
        }

        map.putArray(
            "grantedScopes",
            grantedScopes,
        )

        // Оставляем на будущее, если JS/backend понадобится offline access.
        result.serverAuthCode?.let { code ->
            map.putString(
                "serverAuthCode",
                code,
            )
        }

        promise.resolve(map)
    }

    /**
     * Interactive authorization.
     *
     * If Google already has all grants, the token is returned immediately.
     * Otherwise Google's PendingIntent is launched and the Promise is resolved
     * later from onActivityResult().
     */
    @ReactMethod
    fun authorize(
        scopes: ReadableArray,
        accountName: String?,
        selectAccount: Boolean,
        promise: Promise,
    ) {
        val requestedScopes = scopes(scopes)

        if (requestedScopes.isEmpty()) {
            promise.reject(
                "INVALID_SCOPES",
                "At least one Google OAuth scope is required.",
            )
            return
        }

        val request = buildRequest(
            requestedScopes,
            accountName,
            selectAccount,
        )

        val client =
            Identity.getAuthorizationClient(reactContext)

        client
            .authorize(request)
            .addOnSuccessListener { result ->

                if (!result.hasResolution()) {
                    resolveResult(
                        result,
                        promise,
                    )
                    return@addOnSuccessListener
                }

                val activity =
                    reactContext.currentActivity

                if (activity == null) {
                    promise.reject(
                        "NO_ACTIVITY",
                        "No activity available to resolve Google authorization.",
                    )
                    return@addOnSuccessListener
                }

                val pendingIntent =
                    result.pendingIntent

                if (pendingIntent == null) {
                    promise.reject(
                        "NO_RESOLUTION",
                        "Google authorization requires resolution but returned no PendingIntent.",
                    )
                    return@addOnSuccessListener
                }

                val requestCode =
                    nextRequestCode.incrementAndGet()

                pendingResolutions[requestCode] =
                    promise

                try {
                    activity.startIntentSenderForResult(
                        pendingIntent.intentSender,
                        requestCode,
                        null,
                        0,
                        0,
                        0,
                    )
                } catch (error: Throwable) {
                    pendingResolutions.remove(
                        requestCode,
                    )

                    promise.reject(
                        "AUTHORIZE_FAILED",
                        error,
                    )
                }
            }
            .addOnFailureListener { error ->
                promise.reject(
                    "AUTHORIZE_FAILED",
                    error,
                )
            }
    }

    /**
     * Silent authorization path.
     *
     * Does not launch UI. This is appropriate for background MCP executions.
     */
    @ReactMethod
    fun getAccessToken(
        scopes: ReadableArray,
        accountName: String?,
        promise: Promise,
    ) {
        val requestedScopes =
            scopes(scopes)

        if (requestedScopes.isEmpty()) {
            promise.reject(
                "INVALID_SCOPES",
                "At least one Google OAuth scope is required.",
            )
            return
        }

        val request = buildRequest(
            requestedScopes,
            accountName,
            selectAccount = false,
        )

        val client =
            Identity.getAuthorizationClient(reactContext)

        client
            .authorize(request)
            .addOnSuccessListener { result ->

                if (result.hasResolution()) {
                    promise.reject(
                        "RECONNECT_REQUIRED",
                        "Google requires user interaction or re-consent for the requested access.",
                    )

                    return@addOnSuccessListener
                }

                resolveResult(
                    result,
                    promise,
                )
            }
            .addOnFailureListener { error ->
                promise.reject(
                    "TOKEN_FAILED",
                    error,
                )
            }
    }

    /**
     * Removes a cached access token.
     *
     * This does not revoke the user's OAuth grant.
     */
    @ReactMethod
    fun clearToken(
        accessToken: String,
        promise: Promise,
    ) {
        if (accessToken.isBlank()) {
            promise.resolve(null)
            return
        }

        val request =
            ClearTokenRequest.builder()
                .setToken(accessToken)
                .build()

        Identity
            .getAuthorizationClient(reactContext)
            .clearToken(request)
            .addOnSuccessListener {
                promise.resolve(null)
            }
            .addOnFailureListener { error ->
                promise.reject(
                    "CLEAR_TOKEN_FAILED",
                    error,
                )
            }
    }

    /**
     * Revokes access for an account and/or requested scopes.
     */
    @ReactMethod
    fun revoke(
        accountName: String?,
        scopes: ReadableArray,
        promise: Promise,
    ) {
        val requestedScopes =
            scopes(scopes)

        val builder =
            RevokeAccessRequest.builder()

        if (!accountName.isNullOrBlank()) {
            builder.setAccount(
                Account(
                    accountName,
                    "com.google",
                ),
            )
        }

        if (requestedScopes.isNotEmpty()) {
            builder.setScopes(
                requestedScopes,
            )
        }

        if (
            accountName.isNullOrBlank() &&
            requestedScopes.isEmpty()
        ) {
            promise.reject(
                "INVALID_REVOKE_REQUEST",
                "An account name or at least one scope is required.",
            )
            return
        }

        val request =
            builder.build()

        Identity
            .getAuthorizationClient(reactContext)
            .revokeAccess(request)
            .addOnSuccessListener {
                promise.resolve(null)
            }
            .addOnFailureListener { error ->
                promise.reject(
                    "REVOKE_FAILED",
                    error,
                )
            }
    }

    override fun onActivityResult(
        activity: Activity,
        requestCode: Int,
        resultCode: Int,
        data: Intent?,
    ) {
        val promise =
            pendingResolutions.remove(requestCode)
                ?: return

        Log.d(
            "GoogleAuthorization",
            "onActivityResult requestCode=$requestCode resultCode=$resultCode data=${data != null}"
        )

        if (data == null) {
            if (resultCode == Activity.RESULT_CANCELED) {
                promise.reject(
                    "AUTHORIZE_CANCELLED",
                    "Google authorization UI was closed or cancelled. resultCode=$resultCode",
                )
            } else {
                promise.reject(
                    "AUTHORIZE_FAILED",
                    "Google authorization returned no Intent. resultCode=$resultCode",
                )
            }

            return
        }

        try {
            val client =
                Identity.getAuthorizationClient(activity)

            /*
            * IMPORTANT:
            * Let Google parse the Intent first.
            *
            * getAuthorizationResultFromIntent() either:
            *  - returns AuthorizationResult
            *  - throws ApiException containing the real Google error
            */
            val result =
                client.getAuthorizationResultFromIntent(data)

            Log.d(
                "GoogleAuthorization",
                "Authorization succeeded. scopes=${result.grantedScopes}"
            )

            resolveResult(
                result,
                promise,
            )
        } catch (error: ApiException) {

            /*
            * A cancel arrives here, not in the data == null branch above.
            * Closing Google's sheet returns RESULT_CANCELED *with* an Intent,
            * so parsing proceeds and throws CommonStatusCodes.CANCELED.
            * Without this, backing out of sign-in is reported as a failure and
            * AUTHORIZE_CANCELLED is unreachable in the ordinary path.
            */
            if (error.statusCode == CommonStatusCodes.CANCELED) {
                Log.d(
                    "GoogleAuthorization",
                    "Authorization cancelled by user. resultCode=$resultCode",
                )

                promise.reject(
                    "AUTHORIZE_CANCELLED",
                    "Google authorization was closed or cancelled.",
                )

                return
            }

            val message =
                "Google authorization failed: " +
                    "statusCode=${error.statusCode}, " +
                    "resultCode=$resultCode, " +
                    "message=${error.message}"

            Log.e(
                "GoogleAuthorization",
                message,
                error,
            )

            promise.reject(
                "AUTHORIZE_FAILED",
                message,
                error,
            )
        } catch (error: Throwable) {

            val message =
                "Google authorization failed: " +
                    "resultCode=$resultCode, " +
                    "error=${error.message}"

            Log.e(
                "GoogleAuthorization",
                message,
                error,
            )

            promise.reject(
                "AUTHORIZE_FAILED",
                message,
                error,
            )
        }
    }

    override fun onNewIntent(
        intent: Intent,
    ) = Unit
}