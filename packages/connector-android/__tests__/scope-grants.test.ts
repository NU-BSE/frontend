import {
  computeAndroidCapabilities,
  computeAndroidScopes,
} from '../src/android-connector';

describe('computeAndroidScopes (fresh-install capability grant)', () => {
  it('grants the read scope always, and nothing else by default', () => {
    expect(
      computeAndroidScopes({
        canWrite: false,
        canOverlay: false,
        assistantBridgePresent: false,
        signalBridgePresent: false,
        usageGranted: false,
        notificationsGranted: false,
      }),
    ).toEqual(['android.settings.read']);
  });

  it('grants android.settings.write and overlay only when live access exists', () => {
    expect(
      computeAndroidScopes({
        canWrite: true,
        canOverlay: true,
        assistantBridgePresent: false,
        signalBridgePresent: false,
        usageGranted: false,
        notificationsGranted: false,
      }),
    ).toEqual(['android.settings.read', 'android.settings.write', 'android.overlay']);
  });

  it('grants usage read only when usage access is granted', () => {
    expect(
      computeAndroidScopes({
        canWrite: false,
        canOverlay: false,
        assistantBridgePresent: false,
        signalBridgePresent: true,
        usageGranted: true,
        notificationsGranted: false,
      }),
    ).toEqual(['android.settings.read', 'android.usage.read']);
  });

  it('grants notification + media scopes only when notification access is granted', () => {
    expect(
      computeAndroidScopes({
        canWrite: false,
        canOverlay: false,
        assistantBridgePresent: false,
        signalBridgePresent: true,
        usageGranted: false,
        notificationsGranted: true,
      }),
    ).toEqual([
      'android.settings.read',
      'android.notifications.read',
      'android.notifications.reply',
      'android.media.read',
      'android.media.control',
    ]);
  });

  it('keeps media scopes off when notification access is missing (media depends on the listener)', () => {
    const scopes = computeAndroidScopes({
      canWrite: false,
      canOverlay: false,
      assistantBridgePresent: false,
      signalBridgePresent: true,
      usageGranted: false,
      notificationsGranted: false,
    });
    expect(scopes).not.toContain('android.media.read');
    expect(scopes).not.toContain('android.media.control');
  });

  it('grants assistant scopes only when the assistant bridge exists', () => {
    expect(
      computeAndroidScopes({
        canWrite: false,
        canOverlay: false,
        assistantBridgePresent: true,
        signalBridgePresent: false,
        usageGranted: false,
        notificationsGranted: false,
      }),
    ).toEqual([
      'android.settings.read',
      'android.assistant.read',
      'android.assistant.manage',
      'android.assistant.screen_context',
    ]);
  });
});

describe('computeAndroidCapabilities', () => {
  it('advertises signal capabilities only when the signal bridge exists', () => {
    const withSignals = computeAndroidCapabilities({
      assistantBridgePresent: false,
      signalBridgePresent: true,
    });
    expect(withSignals).toEqual(
      expect.arrayContaining([
        'android.usage.read',
        'android.notifications.read',
        'android.notifications.reply',
        'android.media.read',
        'android.media.control',
      ]),
    );

    const withoutSignals = computeAndroidCapabilities({
      assistantBridgePresent: false,
      signalBridgePresent: false,
    });
    expect(withoutSignals).not.toContain('android.usage.read');
  });
});