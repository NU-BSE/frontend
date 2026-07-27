import { NativeModules, Platform } from 'react-native';

type NativeProbeResult<T> = Promise<T>;

export type AndroidNativeSignals = {
  debuggablePackage: boolean;
  installerPackageName?: string;
  strongBoxAvailable?: boolean;
  emulator?: boolean;
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
};

type AttestationNativeProbesModule = {
  tcpProbeLocalhost?: (
    port: number,
    timeoutMs: number,
  ) => NativeProbeResult<{ open: boolean; reason?: string }>;
  fileExists?: (path: string) => NativeProbeResult<boolean>;
  readProcSelfMaps?: () => NativeProbeResult<string>;
  isDebuggerAttached?: () => NativeProbeResult<boolean>;
  getAndroidSignals?: () => NativeProbeResult<AndroidNativeSignals>;
  suspiciousDyldImages?: () => NativeProbeResult<string[]>;
  envVar?: (name: string) => NativeProbeResult<string | null>;
  canOpenUrlScheme?: (scheme: string) => NativeProbeResult<boolean>;
  generateHardwareKeyAttestation?: (
    alias: string,
    challengeBase64: string,
  ) => NativeProbeResult<{
    alias: string;
    certificateChainBase64: string[];
    strongBoxBacked: boolean;
    strongBoxRequested?: boolean;
    strongBoxFallbackReason?: string;
  }>;
};

const moduleCandidate =
  NativeModules.AttestationNativeProbes as
    | AttestationNativeProbesModule
    | undefined;

const unavailable = async <T>(method: string): Promise<T> => {
  throw new Error(
    `AttestationNativeProbes.${method} is unavailable on ${Platform.OS}`,
  );
};

export const AttestationNativeProbes: Required<AttestationNativeProbesModule> = {
  tcpProbeLocalhost: (port, timeoutMs) =>
    moduleCandidate?.tcpProbeLocalhost?.(port, timeoutMs) ??
    unavailable('tcpProbeLocalhost'),
  fileExists: (path) =>
    moduleCandidate?.fileExists?.(path) ?? unavailable('fileExists'),
  readProcSelfMaps: () =>
    moduleCandidate?.readProcSelfMaps?.() ?? unavailable('readProcSelfMaps'),
  isDebuggerAttached: () =>
    moduleCandidate?.isDebuggerAttached?.() ??
    unavailable('isDebuggerAttached'),
  getAndroidSignals: () =>
    moduleCandidate?.getAndroidSignals?.() ??
    unavailable('getAndroidSignals'),
  suspiciousDyldImages: () =>
    moduleCandidate?.suspiciousDyldImages?.() ??
    unavailable('suspiciousDyldImages'),
  envVar: (name) => moduleCandidate?.envVar?.(name) ?? unavailable('envVar'),
  canOpenUrlScheme: (scheme) =>
    moduleCandidate?.canOpenUrlScheme?.(scheme) ??
    unavailable('canOpenUrlScheme'),
  generateHardwareKeyAttestation: (alias, challengeBase64) =>
    moduleCandidate?.generateHardwareKeyAttestation?.(alias, challengeBase64) ??
    unavailable('generateHardwareKeyAttestation'),
};
