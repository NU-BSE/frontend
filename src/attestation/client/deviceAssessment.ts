import { Platform } from 'react-native';

import {
  AttestationNativeProbes,
  type AndroidNativeSignals,
} from '../native/AttestationNativeProbes';

export type DeviceIntegrityStatus =
  | 'trusted'
  | 'warning'
  | 'blocked'
  | 'unavailable';

export type AndroidDeviceAssessment = {
  schemaVersion: 1;
  platform: 'android';
  collectedAtMs: number;
  hardware: {
    model?: string;
    brand?: string;
    manufacturer?: string;
    product?: string;
    hardware?: string;
    sdkInt?: number;
    osRelease?: string;
    securityPatch?: string;
    supportedAbis: string[];
    cpuCoreCount?: number;
    totalMemoryBytes?: number;
    availableMemoryBytes?: number;
    memoryClassMb?: number;
    largeMemoryClassMb?: number;
    lowRamDevice?: boolean;
    totalStorageBytes?: number;
    availableStorageBytes?: number;
    screenWidthPx?: number;
    screenHeightPx?: number;
    densityDpi?: number;
    powerSaveMode?: boolean;
    thermalStatus?: number;
    strongBoxAvailable?: boolean;
  };
  integrity: {
    status: DeviceIntegrityStatus;
    nativeProbeAvailable: boolean;
    physicalDevice: boolean;
    debuggerAttached: boolean;
    rooted: boolean;
    hookFrameworkDetected: boolean;
    debuggablePackage: boolean;
    untrustedInstaller: boolean;
    installerPackageName?: string;
    riskFlags: string[];
  };
  keystore: {
    checked: boolean;
    hardwareBacked: boolean;
    strongBoxBacked: boolean;
    certificateChainLength: number;
    fallbackReason?: string;
  };
  probeFailures: string[];
};

export type DeviceAssessment =
  | AndroidDeviceAssessment
  | {
      schemaVersion: 1;
      platform: 'unsupported';
      collectedAtMs: number;
      reason: string;
    };

type ProbeResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const PROBE_TIMEOUT_MS = 1_500;
const TRUSTED_INSTALLERS = new Set([
  'com.android.vending',
  'com.google.android.feedback',
  'com.amazon.venezia',
]);

const withTimeout = async <T>(
  label: string,
  probe: () => Promise<T>,
): Promise<ProbeResult<T>> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      probe(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} exceeded ${PROBE_TIMEOUT_MS}ms`)),
          PROBE_TIMEOUT_MS,
        );
      }),
    ]);
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const makeChallenge = (): string => {
  const bytes = new Uint8Array(32);
  const cryptoApi = globalThis.crypto as
    | { getRandomValues?: (input: Uint8Array) => Uint8Array }
    | undefined;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const encodeBase64 = (globalThis as {
    btoa?: (value: string) => string;
  }).btoa;
  if (!encodeBase64) {
    throw new Error('Base64 encoding is unavailable in this runtime.');
  }
  const encoded = encodeBase64(binary);
  return encoded.replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
};

const readValue = <T>(result: ProbeResult<T>, fallback: T): T =>
  result.ok ? result.value : fallback;

export async function collectDeviceAssessment(): Promise<DeviceAssessment> {
  if (Platform.OS !== 'android') {
    return {
      schemaVersion: 1,
      platform: 'unsupported',
      collectedAtMs: Date.now(),
      reason: 'Local LLM execution is supported only on Android.',
    };
  }

  const [
    signalsResult,
    debuggerResult,
    frida27042Result,
    frida27043Result,
    mapsResult,
    suSystemResult,
    suXbinResult,
    magiskResult,
    hardwareKeyResult,
  ] = await Promise.all([
    withTimeout('Android hardware signals', () =>
      AttestationNativeProbes.getAndroidSignals(),
    ),
    withTimeout('Debugger probe', () =>
      AttestationNativeProbes.isDebuggerAttached(),
    ),
    withTimeout('Frida port 27042', () =>
      AttestationNativeProbes.tcpProbeLocalhost(27042, 200),
    ),
    withTimeout('Frida port 27043', () =>
      AttestationNativeProbes.tcpProbeLocalhost(27043, 200),
    ),
    withTimeout('Process maps', () => AttestationNativeProbes.readProcSelfMaps()),
    withTimeout('Root path /system/bin/su', () =>
      AttestationNativeProbes.fileExists('/system/bin/su'),
    ),
    withTimeout('Root path /system/xbin/su', () =>
      AttestationNativeProbes.fileExists('/system/xbin/su'),
    ),
    withTimeout('Magisk path', () =>
      AttestationNativeProbes.fileExists('/data/adb/magisk'),
    ),
    withTimeout('Android hardware key attestation', () =>
      AttestationNativeProbes.generateHardwareKeyAttestation(
        'creepyim.llm.assessment.v1',
        makeChallenge(),
      ),
    ),
  ]);

  const failures: string[] = [];
  const recordFailure = <T>(name: string, result: ProbeResult<T>): void => {
    if (!result.ok) failures.push(`${name}: ${result.reason}`);
  };
  recordFailure('hardware', signalsResult);
  recordFailure('debugger', debuggerResult);
  recordFailure('frida:27042', frida27042Result);
  recordFailure('frida:27043', frida27043Result);
  recordFailure('proc-maps', mapsResult);
  recordFailure('root:system-bin', suSystemResult);
  recordFailure('root:system-xbin', suXbinResult);
  recordFailure('root:magisk', magiskResult);
  recordFailure('keystore', hardwareKeyResult);

  const signals: AndroidNativeSignals = readValue(signalsResult, {
    debuggablePackage: false,
    supportedAbis: [],
  });
  const procMaps = readValue(mapsResult, '');
  const rooted =
    readValue(suSystemResult, false) ||
    readValue(suXbinResult, false) ||
    readValue(magiskResult, false) ||
    /magisk|zygisk|riru/iu.test(procMaps);
  const hookFrameworkDetected =
    readValue(frida27042Result, { open: false }).open ||
    readValue(frida27043Result, { open: false }).open ||
    /frida|xposed|substrate|zygisk|riru/iu.test(procMaps);
  const debuggerAttached = readValue(debuggerResult, false);
  const installer = signals.installerPackageName;
  const untrustedInstaller = Boolean(
    installer && !TRUSTED_INSTALLERS.has(installer),
  );
  const nativeProbeAvailable = signalsResult.ok;
  const physicalDevice = signals.emulator !== true;

  const riskFlags = [
    !nativeProbeAvailable && 'NATIVE_PROBE_UNAVAILABLE',
    !physicalDevice && 'EMULATOR',
    debuggerAttached && 'DEBUGGER',
    rooted && 'ROOT',
    hookFrameworkDetected && 'HOOK_FRAMEWORK',
    signals.debuggablePackage && 'DEBUGGABLE_PACKAGE',
    untrustedInstaller && 'UNTRUSTED_INSTALLER',
  ].filter((flag): flag is string => Boolean(flag));

  const status: DeviceIntegrityStatus =
    rooted || hookFrameworkDetected || !physicalDevice
      ? 'blocked'
      : !nativeProbeAvailable
        ? 'unavailable'
        : debuggerAttached || signals.debuggablePackage || untrustedInstaller
          ? 'warning'
          : 'trusted';

  const key = hardwareKeyResult.ok ? hardwareKeyResult.value : null;

  return {
    schemaVersion: 1,
    platform: 'android',
    collectedAtMs: Date.now(),
    hardware: {
      model: signals.model,
      brand: signals.brand,
      manufacturer: signals.manufacturer,
      product: signals.product,
      hardware: signals.hardware,
      sdkInt: signals.sdkInt,
      osRelease: signals.osRelease,
      securityPatch: signals.securityPatch,
      supportedAbis: signals.supportedAbis ?? [],
      cpuCoreCount: signals.cpuCoreCount,
      totalMemoryBytes: signals.totalMemoryBytes,
      availableMemoryBytes: signals.availableMemoryBytes,
      memoryClassMb: signals.memoryClassMb,
      largeMemoryClassMb: signals.largeMemoryClassMb,
      lowRamDevice: signals.lowRamDevice,
      totalStorageBytes: signals.totalStorageBytes,
      availableStorageBytes: signals.availableStorageBytes,
      screenWidthPx: signals.screenWidthPx,
      screenHeightPx: signals.screenHeightPx,
      densityDpi: signals.densityDpi,
      powerSaveMode: signals.powerSaveMode,
      thermalStatus: signals.thermalStatus,
      strongBoxAvailable: signals.strongBoxAvailable,
    },
    integrity: {
      status,
      nativeProbeAvailable,
      physicalDevice,
      debuggerAttached,
      rooted,
      hookFrameworkDetected,
      debuggablePackage: signals.debuggablePackage ?? false,
      untrustedInstaller,
      installerPackageName: installer,
      riskFlags,
    },
    keystore: {
      checked: hardwareKeyResult.ok,
      hardwareBacked: Boolean(key && key.certificateChainBase64.length > 0),
      strongBoxBacked: key?.strongBoxBacked ?? false,
      certificateChainLength: key?.certificateChainBase64.length ?? 0,
      fallbackReason: key?.strongBoxFallbackReason,
    },
    probeFailures: failures,
  };
}
