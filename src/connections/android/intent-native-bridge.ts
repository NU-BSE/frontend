import type { AndroidIntentBridge } from '@mobile-agent/connector-intents';

/** Raw outward-intent methods exposed by CreepyAndroidSettings native module. */
type NativeAndroidIntentModule = {
  intentOpenUri(uri: string): Promise<boolean>;
  intentOpenApp(packageName: string): Promise<boolean>;
  intentShareText(text: string, targetPackage: string | null): Promise<boolean>;
  intentShareFile(
    fileUri: string,
    mimeType: string | null,
    targetPackage: string | null,
  ): Promise<boolean>;
  intentComposeEmail(
    to: string | null,
    subject: string | null,
    body: string | null,
  ): Promise<boolean>;
  intentOpenMap(
    query: string | null,
    latitude: number | null,
    longitude: number | null,
  ): Promise<boolean>;
  intentOpenDialer(phoneNumber: string | null): Promise<boolean>;
};

/** Returns a real Android intent bridge, or null outside a native Android build. */
export function getAndroidIntentBridge(): AndroidIntentBridge | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native') as typeof import('react-native');
    if (Platform.OS !== 'android') return null;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireNativeModule } = require('expo-modules-core') as {
      requireNativeModule: <T>(name: string) => T | null;
    };

    const native = requireNativeModule<NativeAndroidIntentModule>(
      'CreepyAndroidSettings',
    );
    if (!native) return null;

    return {
      openUri: (uri: string) => native.intentOpenUri(uri),
      openApp: (packageName: string) => native.intentOpenApp(packageName),
      shareText: (text: string, targetPackage?: string) =>
        native.intentShareText(text, targetPackage ?? null),
      shareFile: (fileUri: string, mimeType?: string, targetPackage?: string) =>
        native.intentShareFile(fileUri, mimeType ?? null, targetPackage ?? null),
      composeEmail: (to?: string, subject?: string, body?: string) =>
        native.intentComposeEmail(to ?? null, subject ?? null, body ?? null),
      openMap: (query?: string, latitude?: number, longitude?: number) =>
        native.intentOpenMap(query ?? null, latitude ?? null, longitude ?? null),
      openDialer: (phoneNumber?: string) =>
        native.intentOpenDialer(phoneNumber ?? null),
    };
  } catch {
    return null;
  }
}
