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
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.spec.ECGenParameterSpec
import java.util.Base64

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
      val challenge = Base64.getUrlDecoder().decode(challengeBase64)
      val strongBoxRequested =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
          reactContext.packageManager.hasSystemFeature(
            "android.hardware.strongbox_keystore",
          )
      var strongBoxBacked = strongBoxRequested
      var strongBoxFallbackReason: String? = null
      try {
        generateAttestedKey(alias, challenge, strongBoxBacked = strongBoxRequested)
      } catch (error: Throwable) {
        if (!strongBoxRequested) throw error
        strongBoxBacked = false
        strongBoxFallbackReason = error.message ?: error.javaClass.simpleName
        generateAttestedKey(alias, challenge, strongBoxBacked = false)
      }

      val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      val certs = keyStore.getCertificateChain(alias)
        ?: throw IllegalStateException("AndroidKeyStore returned no certificate chain")
      val chain = WritableNativeArray()
      certs.forEach { cert ->
        chain.pushString(Base64.getEncoder().encodeToString(cert.encoded))
      }
      val result = WritableNativeMap()
      result.putString("alias", alias)
      result.putArray("certificateChainBase64", chain)
      result.putBoolean("strongBoxBacked", strongBoxBacked)
      result.putBoolean("strongBoxRequested", strongBoxRequested)
      if (strongBoxFallbackReason != null) {
        result.putString("strongBoxFallbackReason", strongBoxFallbackReason)
      }
      promise.resolve(result)
    } catch (error: Throwable) {
      promise.reject("KEY_ATTESTATION_FAILED", error)
    }
  }

  private fun generateAttestedKey(
    alias: String,
    challenge: ByteArray,
    strongBoxBacked: Boolean,
  ) {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)

    val generator = KeyPairGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_EC,
      "AndroidKeyStore",
    )
    val builder = KeyGenParameterSpec.Builder(
      alias,
      KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
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

  private fun isProbablyEmulator(): Boolean =
    Build.FINGERPRINT.startsWith("generic") ||
      Build.FINGERPRINT.startsWith("unknown") ||
      Build.MODEL.contains("google_sdk", ignoreCase = true) ||
      Build.MODEL.contains("Emulator", ignoreCase = true) ||
      Build.MODEL.contains("Android SDK built for", ignoreCase = true) ||
      Build.MANUFACTURER.contains("Genymotion", ignoreCase = true) ||
      Build.BRAND.startsWith("generic") && Build.DEVICE.startsWith("generic") ||
      Build.PRODUCT == "google_sdk"
}
