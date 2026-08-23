package com.attestation.nativeprobes

import android.app.ActivityManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Build
import android.os.Debug
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.DisplayMetrics
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.security.Key
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

class AttestationNativeProbesModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "AttestationNativeProbes"

  @ReactMethod
  fun tcpProbeLocalhost(port: Int, timeoutMs: Int, promise: Promise) {
    val result = WritableNativeMap()
    try {
      Socket().use { socket ->
        socket.connect(InetSocketAddress("127.0.0.1", port), timeoutMs)
      }
      result.putBoolean("open", true)
    } catch (error: Throwable) {
      result.putBoolean("open", false)
      result.putString("reason", error.message ?: error.javaClass.simpleName)
    }
    promise.resolve(result)
  }

  @ReactMethod
  fun fileExists(path: String, promise: Promise) {
    promise.resolve(File(path).exists())
  }

  @ReactMethod
  fun readProcSelfMaps(promise: Promise) {
    try {
      val maps = File("/proc/self/maps").readText().take(128 * 1024)
      promise.resolve(maps)
    } catch (error: Throwable) {
      promise.reject("PROC_MAPS_READ_FAILED", error)
    }
  }

  @ReactMethod
  fun isDebuggerAttached(promise: Promise) {
    val traced = try {
      File("/proc/self/status")
        .readLines()
        .firstOrNull { it.startsWith("TracerPid:") }
        ?.substringAfter(":")
        ?.trim()
        ?.toIntOrNull()
        ?.let { it > 0 } ?: false
    } catch (_: Throwable) {
      false
    }
    promise.resolve(Debug.isDebuggerConnected() || traced)
  }

  @ReactMethod
  fun getAndroidSignals(promise: Promise) {
    try {
      val map = WritableNativeMap()
      val appInfo = reactContext.applicationInfo
      val packageManager = reactContext.packageManager
      val activityManager =
        reactContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val powerManager =
        reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
      val installer = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        packageManager.getInstallSourceInfo(reactContext.packageName).installingPackageName
      } else {
        @Suppress("DEPRECATION")
        packageManager.getInstallerPackageName(reactContext.packageName)
      }
      val memoryInfo = ActivityManager.MemoryInfo().also(activityManager::getMemoryInfo)
      val storage = StatFs(Environment.getDataDirectory().absolutePath)
      val metrics: DisplayMetrics = reactContext.resources.displayMetrics
      val abis = WritableNativeArray().apply {
        Build.SUPPORTED_ABIS.forEach(::pushString)
      }

      map.putBoolean(
        "debuggablePackage",
        appInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0,
      )
      map.putString("installerPackageName", installer)
      map.putString("model", Build.MODEL)
      map.putString("brand", Build.BRAND)
      map.putString("manufacturer", Build.MANUFACTURER)
      map.putString("product", Build.PRODUCT)
      map.putString("hardware", Build.HARDWARE)
      map.putInt("sdkInt", Build.VERSION.SDK_INT)
      map.putString("osRelease", Build.VERSION.RELEASE)
      map.putString("securityPatch", Build.VERSION.SECURITY_PATCH)
      map.putArray("supportedAbis", abis)
      map.putInt("cpuCoreCount", Runtime.getRuntime().availableProcessors())
      map.putDouble("totalMemoryBytes", memoryInfo.totalMem.toDouble())
      map.putDouble("availableMemoryBytes", memoryInfo.availMem.toDouble())
      map.putInt("memoryClassMb", activityManager.memoryClass)
      map.putInt("largeMemoryClassMb", activityManager.largeMemoryClass)
      map.putBoolean("lowRamDevice", activityManager.isLowRamDevice)
      map.putDouble("totalStorageBytes", storage.totalBytes.toDouble())
      map.putDouble("availableStorageBytes", storage.availableBytes.toDouble())
      map.putInt("screenWidthPx", metrics.widthPixels)
      map.putInt("screenHeightPx", metrics.heightPixels)
      map.putInt("densityDpi", metrics.densityDpi)
      map.putBoolean("powerSaveMode", powerManager.isPowerSaveMode)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        map.putInt("thermalStatus", powerManager.currentThermalStatus)
      }
      map.putBoolean(
        "strongBoxAvailable",
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
          packageManager.hasSystemFeature("android.hardware.strongbox_keystore"),
      )
      map.putBoolean("emulator", isProbablyEmulator())
      promise.resolve(map)
    } catch (error: Throwable) {
      promise.reject("ANDROID_SIGNALS_FAILED", error)
    }
  }

  @ReactMethod
  fun generateHardwareKeyAttestation(
    alias: String,
    challengeBase64: String,
    promise: Promise,
  ) {
    try {
      val challenge = decodeBase64(challengeBase64)
      require(challenge.isNotEmpty()) { "Attestation challenge must not be empty" }
      require(challenge.size <= MAX_ATTESTATION_CHALLENGE_BYTES) {
        "Attestation challenge exceeds $MAX_ATTESTATION_CHALLENGE_BYTES bytes"
      }

      val keyStore = androidKeyStore()
      val created = !keyStore.containsAlias(alias)
      val strongBoxRequested = created && isStrongBoxAvailable()
      var strongBoxFallbackReason: String? = null
      if (created) {
        try {
          generateAttestedKey(alias, challenge, strongBoxRequested)
        } catch (error: Throwable) {
          if (!strongBoxRequested) throw error
          strongBoxFallbackReason = error.message ?: error.javaClass.simpleName
          generateAttestedKey(alias, challenge, strongBoxBacked = false)
        }
      }

      val privateKey = keyStore.getKey(alias, null) as? PrivateKey
        ?: throw IllegalStateException("Alias does not contain a private key")
      val securityLevel = getSecurityLevel(
        privateKey,
        strongBoxRequested && strongBoxFallbackReason == null,
      )
      val certs = keyStore.getCertificateChain(alias)
        ?: throw IllegalStateException("AndroidKeyStore returned no certificate chain")
      val chain = WritableNativeArray()
      certs.forEach { cert ->
        chain.pushString(Base64.getEncoder().encodeToString(cert.encoded))
      }

      val result = WritableNativeMap()
      result.putString("alias", alias)
      result.putArray("certificateChainBase64", chain)
      result.putString(
        "publicKeyBase64",
        Base64.getEncoder().encodeToString(certs.first().publicKey.encoded),
      )
      result.putBoolean("created", created)
      result.putBoolean("challengeApplied", created)
      result.putString("securityLevel", securityLevel)
      result.putBoolean("strongBoxBacked", securityLevel == SECURITY_LEVEL_STRONG_BOX)
      result.putBoolean("strongBoxRequested", strongBoxRequested)
      if (strongBoxFallbackReason != null) {
        result.putString("strongBoxFallbackReason", strongBoxFallbackReason)
      }
      promise.resolve(result)
    } catch (error: Throwable) {
      promise.reject("KEY_ATTESTATION_FAILED", error)
    }
  }

  @ReactMethod
  fun signDeviceChallenge(
    alias: String,
    challengeBase64: String,
    promise: Promise,
  ) {
    try {
      val challenge = decodeBase64(challengeBase64)
      require(challenge.isNotEmpty()) { "Challenge must not be empty" }
      val keyStore = androidKeyStore()
      val privateKey = keyStore.getKey(alias, null) as? PrivateKey
        ?: throw IllegalStateException("Device identity key does not exist")
      val payload = DEVICE_CHALLENGE_DOMAIN.toByteArray(StandardCharsets.UTF_8) +
        byteArrayOf(0) + challenge
      val signature = Signature.getInstance(SIGNATURE_ALGORITHM).run {
        initSign(privateKey)
        update(payload)
        sign()
      }

      val result = WritableNativeMap()
      result.putString("alias", alias)
      result.putString(
        "signatureBase64",
        Base64.getEncoder().encodeToString(signature),
      )
      result.putString("signatureAlgorithm", SIGNATURE_ALGORITHM)
      result.putString("challengeDomain", DEVICE_CHALLENGE_DOMAIN)
      promise.resolve(result)
    } catch (error: Throwable) {
      promise.reject("KEY_SIGNATURE_FAILED", error)
    }
  }

  @ReactMethod
  fun encryptWithHardwareAesKey(
    alias: String,
    plaintextBase64: String,
    promise: Promise,
  ) {
    try {
      val plaintext = decodeBase64(plaintextBase64)
      val keyStore = androidKeyStore()
      val created = !keyStore.containsAlias(alias)
      val strongBoxRequested = created && isStrongBoxAvailable()
      var strongBoxFallbackReason: String? = null
      if (created) {
        try {
          generateAesKey(alias, strongBoxRequested)
        } catch (error: Throwable) {
          if (!strongBoxRequested) throw error
          strongBoxFallbackReason = error.message ?: error.javaClass.simpleName
          generateAesKey(alias, strongBoxBacked = false)
        }
      }

      val key = keyStore.getKey(alias, null) as? SecretKey
        ?: throw IllegalStateException("Alias does not contain an AES key")
      val securityLevel = getSecurityLevel(
        key,
        strongBoxRequested && strongBoxFallbackReason == null,
      )
      val cipher = Cipher.getInstance(AES_TRANSFORMATION).apply {
        init(Cipher.ENCRYPT_MODE, key)
        updateAAD(LOCAL_SECRET_AAD)
      }
      val ciphertext = cipher.doFinal(plaintext)

      val result = WritableNativeMap()
      result.putString("alias", alias)
      result.putString(
        "ciphertextBase64",
        Base64.getEncoder().encodeToString(ciphertext),
      )
      result.putString(
        "ivBase64",
        Base64.getEncoder().encodeToString(cipher.iv),
      )
      result.putBoolean("created", created)
      result.putString("securityLevel", securityLevel)
      result.putBoolean("strongBoxBacked", securityLevel == SECURITY_LEVEL_STRONG_BOX)
      if (strongBoxFallbackReason != null) {
        result.putString("strongBoxFallbackReason", strongBoxFallbackReason)
      }
      promise.resolve(result)
    } catch (error: Throwable) {
      promise.reject("KEY_ENCRYPTION_FAILED", error)
    }
  }

  @ReactMethod
  fun decryptWithHardwareAesKey(
    alias: String,
    ciphertextBase64: String,
    ivBase64: String,
    promise: Promise,
  ) {
    try {
      val keyStore = androidKeyStore()
      val key = keyStore.getKey(alias, null) as? SecretKey
        ?: throw IllegalStateException("Local secret key does not exist")
      val cipher = Cipher.getInstance(AES_TRANSFORMATION).apply {
        init(
          Cipher.DECRYPT_MODE,
          key,
          GCMParameterSpec(GCM_TAG_LENGTH_BITS, decodeBase64(ivBase64)),
        )
        updateAAD(LOCAL_SECRET_AAD)
      }
      val plaintext = cipher.doFinal(decodeBase64(ciphertextBase64))
      val result = WritableNativeMap()
      result.putString(
        "plaintextBase64",
        Base64.getEncoder().encodeToString(plaintext),
      )
      promise.resolve(result)
    } catch (error: Throwable) {
      promise.reject("KEY_DECRYPTION_FAILED", error)
    }
  }

  private fun generateAttestedKey(
    alias: String,
    challenge: ByteArray,
    strongBoxBacked: Boolean,
  ) {
    val generator = KeyPairGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_EC,
      ANDROID_KEYSTORE,
    )
    val builder = KeyGenParameterSpec.Builder(
      alias,
      KeyProperties.PURPOSE_SIGN,
    )
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256)
      .setAttestationChallenge(challenge)
    if (strongBoxBacked && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      builder.setIsStrongBoxBacked(true)
    }
    generator.initialize(builder.build())
    generator.generateKeyPair()
  }

  private fun generateAesKey(alias: String, strongBoxBacked: Boolean) {
    val generator = KeyGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_AES,
      ANDROID_KEYSTORE,
    )
    val builder = KeyGenParameterSpec.Builder(
      alias,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .setRandomizedEncryptionRequired(true)
    if (strongBoxBacked && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      builder.setIsStrongBoxBacked(true)
    }
    generator.init(builder.build())
    generator.generateKey()
  }

  private fun androidKeyStore(): KeyStore =
    KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

  private fun isStrongBoxAvailable(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
      reactContext.packageManager.hasSystemFeature("android.hardware.strongbox_keystore")

  private fun getSecurityLevel(key: Key, newlyCreatedWithStrongBox: Boolean): String {
    /*
     * The explicit type and cast are both load-bearing.
     *
     * KeyFactory.getKeySpec is generic (`<T : KeySpec> getKeySpec(Key, Class<T>): T`)
     * so that branch yields KeyInfo, but SecretKeyFactory.getKeySpec is not —
     * it is declared `KeySpec getKeySpec(SecretKey, Class<?>)` and returns the
     * raw supertype. Without the cast, `when` infers the common supertype
     * KeySpec, which declares neither securityLevel nor isInsideSecureHardware,
     * and the module fails to compile.
     */
    val keyInfo: KeyInfo = when (key) {
      is PrivateKey -> KeyFactory.getInstance(key.algorithm, ANDROID_KEYSTORE)
        .getKeySpec(key, KeyInfo::class.java)
      is SecretKey -> SecretKeyFactory.getInstance(key.algorithm, ANDROID_KEYSTORE)
        .getKeySpec(key, KeyInfo::class.java) as KeyInfo
      else -> return SECURITY_LEVEL_UNKNOWN
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      return when (keyInfo.securityLevel) {
        KeyProperties.SECURITY_LEVEL_STRONGBOX -> SECURITY_LEVEL_STRONG_BOX
        KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> SECURITY_LEVEL_TRUSTED_ENVIRONMENT
        KeyProperties.SECURITY_LEVEL_UNKNOWN_SECURE -> SECURITY_LEVEL_UNKNOWN_SECURE
        KeyProperties.SECURITY_LEVEL_SOFTWARE -> SECURITY_LEVEL_SOFTWARE
        else -> SECURITY_LEVEL_UNKNOWN
      }
    }

    @Suppress("DEPRECATION")
    return when {
      newlyCreatedWithStrongBox && keyInfo.isInsideSecureHardware -> SECURITY_LEVEL_STRONG_BOX
      keyInfo.isInsideSecureHardware -> SECURITY_LEVEL_TRUSTED_ENVIRONMENT
      else -> SECURITY_LEVEL_SOFTWARE
    }
  }

  private fun decodeBase64(value: String): ByteArray = try {
    Base64.getUrlDecoder().decode(value)
  } catch (_: IllegalArgumentException) {
    Base64.getDecoder().decode(value)
  }

  private fun isProbablyEmulator(): Boolean =
    Build.FINGERPRINT.startsWith("generic") ||
      Build.FINGERPRINT.startsWith("unknown") ||
      Build.MODEL.contains("google_sdk", ignoreCase = true) ||
      Build.MODEL.contains("Emulator", ignoreCase = true) ||
      Build.MODEL.contains("Android SDK built for", ignoreCase = true) ||
      Build.MANUFACTURER.contains("Genymotion", ignoreCase = true) ||
      Build.BRAND.startsWith("generic") && Build.DEVICE.startsWith("generic") ||
      Build.PRODUCT == "google_sdk"

  companion object {
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val SIGNATURE_ALGORITHM = "SHA256withECDSA"
    private const val DEVICE_CHALLENGE_DOMAIN = "creepyim-device-challenge-v1"
    private const val AES_TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_LENGTH_BITS = 128
    private const val MAX_ATTESTATION_CHALLENGE_BYTES = 128
    private const val SECURITY_LEVEL_SOFTWARE = "software"
    private const val SECURITY_LEVEL_TRUSTED_ENVIRONMENT = "trustedEnvironment"
    private const val SECURITY_LEVEL_STRONG_BOX = "strongBox"
    private const val SECURITY_LEVEL_UNKNOWN_SECURE = "unknownSecure"
    private const val SECURITY_LEVEL_UNKNOWN = "unknown"
    private val LOCAL_SECRET_AAD =
      "creepyim-local-secret-v1".toByteArray(StandardCharsets.UTF_8)
  }
}
