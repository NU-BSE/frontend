/**
 * Brightness / timeout helpers shared by the wrapper and its unit tests.
 *
 * The native side performs the same conversion and validation (authoritative);
 * these pure functions let the TypeScript wrapper validate arguments early and
 * make the conversion logic testable without a device.
 */

export const BRIGHTNESS_MIN = 0;
export const BRIGHTNESS_MAX = 255;
export const PERCENT_MIN = 0;
export const PERCENT_MAX = 100;

export interface CodedError extends Error {
  code: string;
}

function codedError(code: string, message: string): CodedError {
  const error = new Error(`${code}: ${message}`) as CodedError;
  error.code = code;
  return error;
}

export function invalidArgument(message: string): CodedError {
  return codedError('ERR_INVALID_ARGUMENT', message);
}

export function assertBrightnessInRange(brightness: number): void {
  if (!Number.isFinite(brightness) || brightness < BRIGHTNESS_MIN || brightness > BRIGHTNESS_MAX) {
    throw invalidArgument(
      `brightness must be within ${BRIGHTNESS_MIN}..${BRIGHTNESS_MAX}, received ${brightness}.`,
    );
  }
}

export function assertPercentInRange(percent: number): void {
  if (!Number.isFinite(percent) || percent < PERCENT_MIN || percent > PERCENT_MAX) {
    throw invalidArgument(
      `percent must be within ${PERCENT_MIN}..${PERCENT_MAX}, received ${percent}.`,
    );
  }
}

export function assertScreenTimeoutNonNegative(milliseconds: number): void {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw invalidArgument(`milliseconds must be >= 0, received ${milliseconds}.`);
  }
}

export function percentToBrightness(percent: number): number {
  assertPercentInRange(percent);
  return clamp(Math.round((percent / 100) * 255), BRIGHTNESS_MIN, BRIGHTNESS_MAX);
}

export function brightnessToPercent(brightness: number): number {
  assertBrightnessInRange(brightness);
  return clamp(Math.round((brightness / 255) * 100), PERCENT_MIN, PERCENT_MAX);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Returns a normalized error code for an unknown thrown value. Native modules
 * surface `ERR_*` codes as the `code` property; anything else falls back to
 * `ERR_UNKNOWN`.
 */
export function errorCodeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('ERR_')) {
      return code;
    }
  }
  return 'ERR_UNKNOWN';
}
