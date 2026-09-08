jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  NativeModules: {
    // UsageStats is linked; MediaControl is absent from this build.
    UsageStats: { kind: 'present' },
  },
}));

import {
  getNativeModule,
  getNativeModuleDiagnostics,
} from '@/native/lazyNativeModule';

describe('lazyNativeModule diagnostics (module-linked vs permission)', () => {
  it('reports AVAILABLE for a module linked into the build', () => {
    expect(getNativeModule('UsageStats')).toEqual({ kind: 'present' });
    expect(getNativeModuleDiagnostics('UsageStats')).toEqual({
      platform: 'android',
      present: true,
      reason: 'AVAILABLE',
    });
  });

  it('reports MODULE_NOT_LINKED for an expected module absent from the build', () => {
    expect(getNativeModule('MediaControl')).toBeNull();
    expect(getNativeModuleDiagnostics('MediaControl')).toEqual({
      platform: 'android',
      present: false,
      reason: 'MODULE_NOT_LINKED',
    });
  });

  it('caches the first resolution so a later query sees the same answer', () => {
    expect(getNativeModule('UsageStats')).toEqual({ kind: 'present' });
    expect(getNativeModuleDiagnostics('UsageStats').present).toBe(true);
    expect(getNativeModule('MediaControl')).toBeNull();
  });
});