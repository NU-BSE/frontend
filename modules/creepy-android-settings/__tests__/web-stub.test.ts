import { errorCodeOf } from '../src/conversion';
import { CreepyAndroidSettings } from '../src/CreepyAndroidSettingsModule.web';

describe('unsupported platform behavior (web stub)', () => {
  it('throws ERR_PLATFORM_NOT_SUPPORTED from reads', () => {
    expect(() => CreepyAndroidSettings.getCapabilities()).toThrow('ERR_PLATFORM_NOT_SUPPORTED');
    expect(() => CreepyAndroidSettings.getScreenBrightness()).toThrow('ERR_PLATFORM_NOT_SUPPORTED');
  });

  it('throws ERR_PLATFORM_NOT_SUPPORTED from writes', () => {
    expect(() => CreepyAndroidSettings.setScreenBrightness(128)).toThrow(
      'ERR_PLATFORM_NOT_SUPPORTED',
    );
  });

  it('normalizes the stub error code', () => {
    let captured: unknown;
    try {
      CreepyAndroidSettings.openSettings('wifi');
    } catch (error) {
      captured = error;
    }
    expect(errorCodeOf(captured)).toBe('ERR_PLATFORM_NOT_SUPPORTED');
  });

  it('returns a no-op event subscription', () => {
    const subscription = CreepyAndroidSettings.addListener('onSettingChanged', () => {});
    expect(() => subscription.remove()).not.toThrow();
  });
});
