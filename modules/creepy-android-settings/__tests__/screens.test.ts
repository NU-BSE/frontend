import { SETTINGS_PANELS, SETTINGS_SCREENS } from '../src/screens';

describe('SettingsScreen mapping', () => {
  it('exposes the full screen registry', () => {
    expect(SETTINGS_SCREENS).toHaveLength(24);

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
    ]) {
      expect(SETTINGS_SCREENS).toContain(screen);
    }
  });

  it('has no duplicate screens', () => {
    expect(new Set(SETTINGS_SCREENS).size).toBe(SETTINGS_SCREENS.length);
  });
});

describe('SettingsPanel mapping', () => {
  it('contains exactly the four official panels', () => {
    expect([...SETTINGS_PANELS].sort()).toEqual(['internet', 'nfc', 'volume', 'wifi']);
  });
});
