import {
  assertBrightnessInRange,
  assertPercentInRange,
  assertScreenTimeoutNonNegative,
  brightnessToPercent,
  errorCodeOf,
  invalidArgument,
  percentToBrightness,
} from '../src/conversion';

describe('brightness conversion', () => {
  it('maps percent 0..100 to brightness 0..255', () => {
    expect(percentToBrightness(0)).toBe(0);
    expect(percentToBrightness(100)).toBe(255);
    expect(percentToBrightness(50)).toBe(128);
    expect(percentToBrightness(1)).toBe(3);
  });

  it('maps brightness 0..255 to percent 0..100', () => {
    expect(brightnessToPercent(0)).toBe(0);
    expect(brightnessToPercent(255)).toBe(100);
    expect(brightnessToPercent(120)).toBe(47);
  });
});

describe('argument validation', () => {
  it('rejects out-of-range percent', () => {
    expect(() => percentToBrightness(-20)).toThrow('ERR_INVALID_ARGUMENT');
    expect(() => percentToBrightness(101)).toThrow('ERR_INVALID_ARGUMENT');
    expect(() => assertPercentInRange(Number.NaN)).toThrow('ERR_INVALID_ARGUMENT');
  });

  it('rejects out-of-range brightness', () => {
    expect(() => assertBrightnessInRange(-1)).toThrow('ERR_INVALID_ARGUMENT');
    expect(() => assertBrightnessInRange(256)).toThrow('ERR_INVALID_ARGUMENT');
  });

  it('rejects negative screen timeout', () => {
    expect(() => assertScreenTimeoutNonNegative(-1)).toThrow('ERR_INVALID_ARGUMENT');
    expect(() => assertScreenTimeoutNonNegative(0)).not.toThrow();
    expect(() => assertScreenTimeoutNonNegative(30000)).not.toThrow();
  });
});

describe('error normalization', () => {
  it('extracts ERR_* codes from coded errors', () => {
    expect(errorCodeOf(invalidArgument('bad'))).toBe('ERR_INVALID_ARGUMENT');
  });

  it('falls back to ERR_UNKNOWN for plain errors', () => {
    expect(errorCodeOf(new Error('boom'))).toBe('ERR_UNKNOWN');
    expect(errorCodeOf(undefined)).toBe('ERR_UNKNOWN');
    expect(errorCodeOf('string')).toBe('ERR_UNKNOWN');
  });
});
