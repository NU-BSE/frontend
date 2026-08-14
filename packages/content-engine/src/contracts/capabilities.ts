/**
 * What a document adapter can actually do, and what a device can support.
 *
 * A capability is a promise: an adapter must never advertise `update: true`
 * when it can only regenerate a whole new file. The router and the engine rely
 * on these declarations to decide how (and whether) an operation can run
 * locally.
 */
export interface DocumentCapabilities {
  inspect: boolean;
  read: boolean;
  search: boolean;
  extract: boolean;
  create: boolean;
  update: boolean;

  /** Updates preserve the original formatting/structure (patch, not regenerate). */
  preservesFormattingOnUpdate: boolean;

  tables: boolean;
  images: boolean;
  formulas: boolean;
  sheets: boolean;
  slides: boolean;

  targetedRead: boolean;
  streamingRead: boolean;
  localIndexing: boolean;
}

/**
 * Characteristics of the *device* an operation may run on. Pure contract — no
 * Android attestation or benchmark is implemented here; the app's existing
 * device-capability infrastructure will populate these fields later.
 */
export interface DeviceCapabilities {
  platform: 'android' | 'ios' | 'web' | 'unknown';

  /** Free memory available to the process, in bytes. */
  availableMemoryBytes?: number;

  /** Total physical memory, in bytes. */
  totalMemoryBytes?: number;

  cpuCores?: number;

  lowMemoryDevice?: boolean;

  supportsBackgroundExecution?: boolean;

  networkAvailable?: boolean;

  meteredNetwork?: boolean;

  charging?: boolean;

  metadata?: Readonly<Record<string, unknown>>;
}
