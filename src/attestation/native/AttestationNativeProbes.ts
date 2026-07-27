import { NativeModules, Platform } from 'react-native';

type NativeProbeResult<T> = Promise<T>;

type AttestationNativeProbesModule = {
  tcpProbeLocalhost?: (
    port: number,
    timeoutMs: number,
  ) => NativeProbeResult<{ open: boolean; reason?: string }>;
  fileExists?: (path: string) => NativeProbeResult<boolean>;
  readProcSelfMaps?: () => NativeProbeResult<string>;
  isDebuggerAttached?: () => NativeProbeResult<boolean>;
  getAndroidSignals?: () => NativeProbeResult<{
    debuggablePackage: boolean;
    installerPackageName?: string;
    strongBoxAvailable?: boolean;
    model?: string;
    sdkInt?: number;
  }>;
  suspiciousDyldImages?: () => NativeProbeResult<string[]>;
  envVar?: (name: string) => NativeProbeResult<string | null>;
  canOpenUrlScheme?: (scheme: string) => NativeProbeResult<boolean>;
  generateHardwareKeyAttestation?: (
    alias: string,
    challengeBase64: string,
  ) => NativeProbeResult<{
    alias: string;
    certificateChainBase64: string[];
    /** Which keystore actually produced the key. */
    strongBoxBacked: boolean;
    /** StrongBox was advertised by the device and attempted first. */
    strongBoxRequested?: boolean;
    /** Present when StrongBox was attempted and the TEE was used instead. */
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
