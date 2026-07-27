import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import JailMonkey from 'jail-monkey';
import { AttestationNativeProbes } from '@native/AttestationNativeProbes';
import type { InstrumentationReport } from '@attestation/shared/wire';

type ProbeResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const GLOBAL_BUDGET_MS = 400;
const FRIDA_PORT_TIMEOUT_MS = 150;

const withProbe = async <T>(
  name: string,
  probe: () => Promise<T> | T,
  signal: AbortSignal,
): Promise<[string, ProbeResult<T>]> => {
  if (signal.aborted) {
    return [name, { ok: false, reason: 'aborted before probe started' }];
  }

  try {
    const value = await probe();
    return [name, { ok: true, value }];
  } catch (error) {
    return [
      name,
      {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      },
    ];
  }
};

const safeJailMonkeyCall = (method: string): boolean => {
  const candidate = JailMonkey as unknown as Record<string, unknown>;
  const value = candidate[method];
  if (typeof value === 'function') {
    try {
      return Boolean(value.call(JailMonkey));
    } catch {
      return false;
    }
  }
  return false;
};

const getValue = <T>(
  signals: Record<string, ProbeResult<unknown>>,
  key: string,
): T | undefined => {
  const result = signals[key];
  return result?.ok ? (result.value as T) : undefined;
};

export const runInstrumentationChecks =
  async (): Promise<InstrumentationReport> => {
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GLOBAL_BUDGET_MS);

    const probes: Array<Promise<[string, ProbeResult<unknown>]>> = [
      withProbe(
        'nativeDebuggerAttached',
        () => AttestationNativeProbes.isDebuggerAttached(),
        controller.signal,
      ),
      withProbe(
        'jailMonkeyRooted',
        () => safeJailMonkeyCall('isJailBroken'),
        controller.signal,
      ),
      withProbe(
        'jailMonkeyMockLocation',
        () => safeJailMonkeyCall('canMockLocation'),
        controller.signal,
      ),
      withProbe(
        'deviceIsEmulator',
        () => !Device.isDevice,
        controller.signal,
      ),
      withProbe(
        'applicationId',
        () => Application.applicationId,
        controller.signal,
      ),
    ];

    if (platform === 'android') {
      probes.push(
        withProbe(
          'fridaPort27042',
          () =>
            AttestationNativeProbes.tcpProbeLocalhost(
              27042,
              FRIDA_PORT_TIMEOUT_MS,
            ),
          controller.signal,
        ),
        withProbe(
          'fridaPort27043',
          () =>
            AttestationNativeProbes.tcpProbeLocalhost(
              27043,
              FRIDA_PORT_TIMEOUT_MS,
            ),
          controller.signal,
        ),
        withProbe(
          'fridaServerPath',
          () =>
            AttestationNativeProbes.fileExists(
              '/data/local/tmp/re.frida.server',
            ),
          controller.signal,
        ),
        withProbe(
          'procSelfMaps',
          () => AttestationNativeProbes.readProcSelfMaps(),
          controller.signal,
        ),
        withProbe(
          'androidSignals',
          () => AttestationNativeProbes.getAndroidSignals(),
          controller.signal,
        ),
      );
    } else {
      probes.push(
        withProbe(
          'dyldImages',
          () => AttestationNativeProbes.suspiciousDyldImages(),
          controller.signal,
        ),
        withProbe(
          'dyldInsertLibraries',
          () => AttestationNativeProbes.envVar('DYLD_INSERT_LIBRARIES'),
          controller.signal,
        ),
        ...['cydia', 'sileo', 'zbra', 'filza'].map((scheme) =>
          withProbe(
            `urlScheme:${scheme}`,
            () => AttestationNativeProbes.canOpenUrlScheme(`${scheme}://`),
            controller.signal,
          ),
        ),
        ...['/var/jb', '/var/jb/usr/bin', '/var/containers/Bundle/tweaksupport'].map(
          (path) =>
            withProbe(
              `fileExists:${path}`,
              () => AttestationNativeProbes.fileExists(path),
              controller.signal,
            ),
        ),
      );
    }

    const settled = await Promise.race([
      Promise.allSettled(probes),
      new Promise<PromiseSettledResult<[string, ProbeResult<unknown>]>[]>(
        (resolve) =>
          setTimeout(() => {
            controller.abort();
            resolve([]);
          }, GLOBAL_BUDGET_MS),
      ),
    ]);
    clearTimeout(timeout);

    const signals: Record<string, ProbeResult<unknown>> = {};
    if (settled.length === 0) {
      signals.globalBudget = {
        ok: false,
        reason: `instrumentation exceeded ${GLOBAL_BUDGET_MS}ms budget`,
      };
    }
    for (const item of settled) {
      if (item.status === 'fulfilled') {
        const [name, result] = item.value;
        signals[name] = result;
      }
    }

    const androidSignals = getValue<{
      debuggablePackage: boolean;
      installerPackageName?: string;
      model?: string;
      sdkInt?: number;
    }>(signals, 'androidSignals');
    const procSelfMaps = getValue<string>(signals, 'procSelfMaps') ?? '';
    const dyldImages = getValue<string[]>(signals, 'dyldImages') ?? [];
    const dyldInsertLibraries =
      getValue<string | null>(signals, 'dyldInsertLibraries') ?? null;
    const fridaPorts = [27042, 27043].some((port) => {
      const value = getValue<{ open: boolean }>(signals, `fridaPort${port}`);
      return value?.open === true;
    });
    const suspiciousMaps =
      /frida|xposed|substrate|zygisk|magisk|riru/iu.test(procSelfMaps);
    const suspiciousDyld =
      dyldImages.length > 0 ||
      typeof dyldInsertLibraries === 'string' ||
      Object.entries(signals).some(
        ([key, result]) =>
          key.startsWith('urlScheme:') && result.ok && result.value === true,
      );
    const rootlessPaths = Object.entries(signals).some(
      ([key, result]) =>
        key.startsWith('fileExists:/var/') &&
        result.ok &&
        result.value === true,
    );

    const installer = androidSignals?.installerPackageName;
    const deviceModel =
      androidSignals?.model ??
      Device.modelName ??
      Device.deviceName ??
      undefined;
    const sdkInt =
      androidSignals?.sdkInt ??
      (typeof Device.platformApiLevel === 'number'
        ? Device.platformApiLevel
        : undefined);
    const trustedInstallers = new Set([
      'com.android.vending',
      'com.google.android.feedback',
      'com.amazon.venezia',
    ]);

    const rootedOrJailbroken =
      (getValue<boolean>(signals, 'jailMonkeyRooted') ?? false) ||
      rootlessPaths;

    return {
      platform,
      debuggerAttached:
        getValue<boolean>(signals, 'nativeDebuggerAttached') ??
        safeJailMonkeyCall('isDebuggedMode'),
      emulator:
        getValue<boolean>(signals, 'deviceIsEmulator') ??
        safeJailMonkeyCall('isOnExternalStorage'),
      rootedOrJailbroken,
      hookFrameworkDetected:
        fridaPorts || suspiciousMaps || suspiciousDyld || rootlessPaths,
      debuggablePackage:
        androidSignals?.debuggablePackage ??
        safeJailMonkeyCall('isDebuggedMode'),
      untrustedInstaller:
        platform === 'android'
          ? Boolean(installer && !trustedInstallers.has(installer))
          : rootlessPaths,
      suspiciousEnvVars:
        typeof dyldInsertLibraries === 'string'
          ? ['DYLD_INSERT_LIBRARIES']
          : [],
      ...(deviceModel ? { deviceModel } : {}),
      ...(typeof sdkInt === 'number' ? { sdkInt } : {}),
      signals,
      collectedAtMs: Date.now(),
    };
  };
