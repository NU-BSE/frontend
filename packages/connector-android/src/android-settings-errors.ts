import { ConnectorError } from '@mobile-agent/connector-core';

/**
 * Maps the native `ERR_*` codes thrown by `creepy-android-settings` into the
 * shared `ConnectorError` model so the model never sees a raw Kotlin error or
 * stack trace — only a stable, actionable code.
 */
const NATIVE_TO_CONNECTOR: Record<string, ConnectorError['code']> = {
  ERR_WRITE_SETTINGS_PERMISSION_REQUIRED: 'PERMISSION_REQUIRED',
  ERR_PLATFORM_NOT_SUPPORTED: 'UNSUPPORTED',
  ERR_SETTINGS_SCREEN_UNAVAILABLE: 'UNSUPPORTED',
  ERR_SETTINGS_PANEL_UNAVAILABLE: 'UNSUPPORTED',
  ERR_INVALID_ARGUMENT: 'VALIDATION_FAILED',
  ERR_INVALID_NAMESPACE: 'VALIDATION_FAILED',
  ERR_SETTING_READ_FAILED: 'PROVIDER_ERROR',
  ERR_SETTING_WRITE_FAILED: 'PROVIDER_ERROR',
  ERR_ANDROID_CONTEXT_UNAVAILABLE: 'PROVIDER_ERROR',
};

function nativeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function safeMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    // The native module already emits short, controlled English messages; cap
    // the length so a re-wrapped error can never leak a stack into the model.
    const message = error.message.split('\n')[0]?.trim();
    if (message) return message.slice(0, 500);
  }
  return fallback;
}

/**
 * Converts any native rejection into a `ConnectorError`. If the error is
 * already a `ConnectorError` it is returned unchanged; unknown native errors
 * become `PROVIDER_ERROR` with a sanitized message.
 */
export function mapAndroidSettingsError(
  error: unknown,
  context: string,
): ConnectorError {
  if (error instanceof ConnectorError) return error;

  const code = nativeErrorCode(error);
  const mapped = code ? NATIVE_TO_CONNECTOR[code] : undefined;

  if (mapped) {
    return new ConnectorError(
      `${context}: ${safeMessage(error, 'Android settings operation failed.')}`,
      mapped,
    );
  }

  return new ConnectorError(
    `${context}: ${safeMessage(error, 'Android settings operation failed.')}`,
    'PROVIDER_ERROR',
  );
}
