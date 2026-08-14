export interface DocumentCapabilities {
  inspect: boolean;
  readText: boolean;
  readStructured: boolean;
  search: boolean;
  extract: boolean;
  create: boolean;
  edit: boolean;
  convert: boolean;
  preserveFormatting: boolean;
  comments: boolean;
  tables: boolean;
  images: boolean;
  formulas: boolean;
  sheets: boolean;
  slides: boolean;
  incrementalRead: boolean;
  incrementalWrite: boolean;
}

/**
 * Characteristics of the *device* a document operation may run on. This is a
 * pure contract — no Android attestation or benchmark is implemented here;
 * the app's existing device-capability infrastructure will populate these
 * fields later.
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
