import ExpoModulesCore

/**
 * Android-only module. On iOS every entry point fails with a normalized
 * `ERR_PLATFORM_NOT_SUPPORTED` error so callers can feature-detect Android
 * without a separate platform check.
 */
public class CreepyAndroidSettingsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CreepyAndroidSettings")

    Events("onSettingChanged")

    Function("getCapabilities") { () throws -> [String: Any] in
      throw unsupported()
    }

    Function("getSetting") { (_: String, _: String) throws -> String? in
      throw unsupported()
    }

    Function("getSettingInt") { (_: String, _: String, _: Int) throws -> Int in
      throw unsupported()
    }

    Function("getSystemInt") { (_: String, _: Int) throws -> Int in
      throw unsupported()
    }

    Function("getSystemString") { (_: String) throws -> String? in
      throw unsupported()
    }

    Function("getSystemFloat") { (_: String, _: Float) throws -> Float in
      throw unsupported()
    }

    Function("getSystemLong") { (_: String, _: Int64) throws -> Int64 in
      throw unsupported()
    }

    Function("setSystemInt") { (_: String, _: Int) throws -> Bool in
      throw unsupported()
    }

    Function("setSystemString") { (_: String, _: String) throws -> Bool in
      throw unsupported()
    }

    Function("setSystemFloat") { (_: String, _: Float) throws -> Bool in
      throw unsupported()
    }

    Function("setSystemLong") { (_: String, _: Int64) throws -> Bool in
      throw unsupported()
    }

    Function("getSecureInt") { (_: String, _: Int) throws -> Int in
      throw unsupported()
    }

    Function("getSecureString") { (_: String) throws -> String? in
      throw unsupported()
    }

    Function("getSecureFloat") { (_: String, _: Float) throws -> Float in
      throw unsupported()
    }

    Function("getSecureLong") { (_: String, _: Int64) throws -> Int64 in
      throw unsupported()
    }

    Function("getGlobalInt") { (_: String, _: Int) throws -> Int in
      throw unsupported()
    }

    Function("getGlobalString") { (_: String) throws -> String? in
      throw unsupported()
    }

    Function("getGlobalFloat") { (_: String, _: Float) throws -> Float in
      throw unsupported()
    }

    Function("getGlobalLong") { (_: String, _: Int64) throws -> Int64 in
      throw unsupported()
    }

    Function("canWriteSystemSettings") { () throws -> Bool in
      throw unsupported()
    }

    AsyncFunction("requestWriteSystemSettingsPermission") { () throws -> Bool in
      throw unsupported()
    }

    Function("canDrawOverlays") { () throws -> Bool in
      throw unsupported()
    }

    AsyncFunction("requestOverlayPermission") { () throws -> Bool in
      throw unsupported()
    }

    Function("getScreenBrightness") { () throws -> Int in
      throw unsupported()
    }

    Function("setScreenBrightness") { (_: Int) throws -> Bool in
      throw unsupported()
    }

    Function("getScreenBrightnessPercent") { () throws -> Int in
      throw unsupported()
    }

    Function("setScreenBrightnessPercent") { (_: Int) throws -> Bool in
      throw unsupported()
    }

    Function("getScreenTimeout") { () throws -> Int in
      throw unsupported()
    }

    Function("setScreenTimeout") { (_: Int) throws -> Bool in
      throw unsupported()
    }

    Function("getAutoRotate") { () throws -> Bool in
      throw unsupported()
    }

    Function("setAutoRotate") { (_: Bool) throws -> Bool in
      throw unsupported()
    }

    Function("canOpenSettings") { (_: String) throws -> Bool in
      throw unsupported()
    }

    AsyncFunction("openSettings") { (_: String) throws -> Bool in
      throw unsupported()
    }

    Function("isSettingsPanelSupported") { (_: String) throws -> Bool in
      throw unsupported()
    }

    AsyncFunction("openPanel") { (_: String) throws -> Bool in
      throw unsupported()
    }

    Function("watchSetting") { (_: String, _: String) throws -> String in
      throw unsupported()
    }

    Function("unwatchSetting") { (_: String) throws -> Void in
      throw unsupported()
    }

    Function("unwatchAllSettings") { () throws -> Void in
      throw unsupported()
    }
  }

  private func unsupported() -> Exception {
    return Exception(
      name: "PlatformNotSupportedException",
      description: "CreepyAndroidSettings is only available on Android.",
      code: "ERR_PLATFORM_NOT_SUPPORTED"
    )
  }
}
