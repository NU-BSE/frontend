package com.creepyim.licensing

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import javax.crypto.Cipher
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import java.security.spec.MGF1ParameterSpec

/**
 * The device's identity for model licensing.
 *
 * An RSA key pair generated inside Android Keystore, preferring StrongBox. The
 * private half is never exportable — the platform will not hand it out even to
 * this app — so the model key the server wraps to it can only be unwrapped on
 * this device, in this app, by this installation.
 *
 * What that buys, precisely: a model key recovered from one rooted phone
 * decrypts nothing on any other, and the encrypted shards are inert without a
 * live licence. What it does not buy: secrecy of the *unwrapped* key, or of
 * the weights it decrypts. Both exist in process memory afterwards, and an
 * attacker who already controls the process can read them. Keystore solves key
 * extraction, not plaintext confidentiality — see the note in
 * src/licensing/README.md.
 *
 * Attestation is requested at generation time so the server can verify the key
 * really was created in secure hardware rather than asserted by a modified
 * client. A client that simply claims "StrongBox" proves nothing.
 */
class DeviceKeyModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    /**
     * Create the key if absent, and report what backs it.
     *
     * `challenge` becomes the attestation challenge, binding the certificate
     * chain to a server-issued nonce. Without it a chain captured from a
     * genuine device could be replayed by a modified one.
     */
    @ReactMethod
    fun ensureDeviceKey(challenge: String, promise: Promise) {
        try {
            val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

            /*
             * A key generated for an earlier challenge cannot prove freshness
             * for this one, so the pair is regenerated per licence request.
             * RSA-2048 generation costs a few hundred milliseconds, which is
             * acceptable at licence time and buys a chain that is bound to
             * exactly this request.
             */
            if (store.containsAlias(ALIAS)) store.deleteEntry(ALIAS)

            val strongBox = generate(challenge, requireStrongBox = true)
            val backing = if (strongBox) "strongbox" else {
                generate(challenge, requireStrongBox = false)
                "tee-or-software"
            }

            val entry = store.getCertificateChain(ALIAS)
                ?: throw IllegalStateException("No certificate chain for the device key.")

            val publicKey = store.getCertificate(ALIAS).publicKey
            val chain = Arguments.createArray()
            for (certificate in entry) {
                chain.pushString(Base64.encodeToString(certificate.encoded, Base64.NO_WRAP))
            }

            promise.resolve(
                Arguments.createMap().apply {
                    // SubjectPublicKeyInfo DER, which is what the server's
                    // load_der_public_key expects.
                    putString(
                        "publicKey",
                        Base64.encodeToString(publicKey.encoded, Base64.NO_WRAP),
                    )
                    putArray("attestationChain", chain)
                    putString("backing", backing)
                },
            )
        } catch (error: Throwable) {
            promise.reject("DEVICE_KEY_FAILED", error.message, error)
        }
    }

    /**
     * Generates the pair, returning whether StrongBox was used.
     *
     * StrongBox is a separate security chip and is absent on most mid-range
     * hardware, so its absence is a normal outcome rather than a failure —
     * the server decides whether TEE-backed is good enough, because that is a
     * policy question and the client is not trusted to answer it.
     */
    private fun generate(challenge: String, requireStrongBox: Boolean): Boolean {
        if (requireStrongBox && Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return false

        val spec = KeyGenParameterSpec.Builder(
            ALIAS,
            KeyProperties.PURPOSE_DECRYPT,
        )
            .setKeySize(2048)
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
            /*
             * No setUserAuthenticationRequired: the model is decrypted at
             * launch and during background work, and demanding a fingerprint
             * for every unwrap would break both. The licence's expiry is what
             * bounds the grant instead.
             */
            .setAttestationChallenge(challenge.toByteArray())
            .apply {
                if (requireStrongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    setIsStrongBoxBacked(true)
                }
            }
            .build()

        return try {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, ANDROID_KEYSTORE)
                .apply { initialize(spec) }
                .generateKeyPair()
            true
        } catch (error: StrongBoxUnavailableException) {
            if (requireStrongBox) false else throw error
        } catch (error: Throwable) {
            if (requireStrongBox) false else throw error
        }
    }

    /**
     * Unwraps the model key inside the keystore.
     *
     * The private key is a handle, not material: `Cipher` routes the operation
     * into the TEE or StrongBox, and the app never sees the private half. The
     * *result* is ordinary memory, which is the boundary of this protection.
     */
    @ReactMethod
    fun unwrapModelKey(wrappedBase64: String, promise: Promise) {
        try {
            val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            val privateKey = store.getKey(ALIAS, null) as? PrivateKey
                ?: throw IllegalStateException("No device key; request a licence first.")

            val cipher = Cipher.getInstance("RSA/ECB/OAEPPadding").apply {
                /*
                 * The parameters are specified explicitly. Android's default
                 * OAEP MGF1 digest is SHA-1 even when the main digest is
                 * SHA-256, which silently disagrees with a server that used
                 * SHA-256 for both and fails as a padding error at unwrap time.
                 */
                init(
                    Cipher.DECRYPT_MODE,
                    privateKey,
                    OAEPParameterSpec(
                        "SHA-256",
                        "MGF1",
                        MGF1ParameterSpec.SHA256,
                        PSource.PSpecified.DEFAULT,
                    ),
                )
            }

            val wrapped = Base64.decode(wrappedBase64, Base64.NO_WRAP)
            val key = cipher.doFinal(wrapped)
            promise.resolve(Base64.encodeToString(key, Base64.NO_WRAP))
        } catch (error: Throwable) {
            promise.reject("UNWRAP_FAILED", error.message, error)
        }
    }

    /** Whether a device key currently exists. */
    @ReactMethod
    fun hasDeviceKey(promise: Promise) {
        promise.resolve(
            try {
                KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }.containsAlias(ALIAS)
            } catch (error: Throwable) {
                false
            },
        )
    }

    /** Forget the device key, e.g. on sign-out. */
    @ReactMethod
    fun clearDeviceKey(promise: Promise) {
        try {
            KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }.deleteEntry(ALIAS)
        } catch (error: Throwable) {
            // Already absent is the desired end state.
        }
        promise.resolve(null)
    }

    companion object {
        const val NAME = "DeviceKey"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val ALIAS = "creepyim.model.device-key.v1"
    }
}
