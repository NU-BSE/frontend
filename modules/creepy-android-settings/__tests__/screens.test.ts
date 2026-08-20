import {
  APP_SETTINGS_TARGETS,
  SETTINGS_PANELS,
  SETTINGS_SCREENS,
} from '../src/screens';

describe('SettingsScreen mapping', () => {
  it('exposes the global screen registry', () => {
    expect(SETTINGS_SCREENS).toHaveLength(48);

    for (const screen of [
      'settings',
      'appDetails',
      'wifi',
      'bluetooth',
      'wireless',
      'location',
      'display',
      'sound',
      'notifications',
      'accessibility',
      'usageAccess',
      'notificationListener',
      'overlay',
      'writeSettings',
      'batteryOptimization',
      'unknownSources',
      'security',
      'privacy',
      'vpn',
      'nfc',
      'language',
      'dateTime',
      'keyboard',
      'developerOptions',
      'apps',
      'allApps',
      'defaultApps',
      'home',
      'batterySaver',
      'dataUsage',
      'airplaneMode',
      'apn',
      'roaming',
      'doNotDisturb',
      'storage',
      'deviceInfo',
      'systemUpdate',
      'sync',
      'addAccount',
      'userDictionary',
      'hardwareKeyboard',
      'captioning',
      'cast',
      'print',
      'dream',
      'autoRotateSettings',
      'webView',
      'allNotifications',
    ]) {
      expect(SETTINGS_SCREENS).toContain(screen);
    }
  });

  it('has no duplicate screens', () => {
    expect(new Set(SETTINGS_SCREENS).size).toBe(SETTINGS_SCREENS.length);
  });
});

describe('AppSettingsTarget mapping', () => {
  it('contains only parameterized app destinations', () => {
    expect(APP_SETTINGS_TARGETS).toEqual([
      'appDetails',
      'appNotifications',
      'notificationChannel',
      'notificationBubbles',
      'appOpenByDefault',
      'appLocale',
      'appUsage',
      'backgroundData',
    ]);
    expect(new Set(APP_SETTINGS_TARGETS).size).toBe(APP_SETTINGS_TARGETS.length);
  });
});

describe('SettingsPanel mapping', () => {
  it('contains exactly the four official panels', () => {
    expect([...SETTINGS_PANELS].sort()).toEqual(['internet', 'nfc', 'volume', 'wifi']);
  });
});
