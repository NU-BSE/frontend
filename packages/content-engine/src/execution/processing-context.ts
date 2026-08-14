/**
 * The complete set of routing inputs for a single document operation.
 *
 * `document`, `operation` and `policy` are always required; `device` and
 * `complexity` are optional evidence the orchestrator fills in when available.
 * A router must never depend on fields that are absent.
 */
import type { DocumentRef } from '../contracts/document-ref';
import type { DeviceCapabilities } from '../contracts/capabilities';

import type { DocumentComplexity } from './document-complexity';
import type { ProcessingPolicy } from './processing-policy';
import type { DocumentOperationDescriptor } from './types';

export interface ProcessingContext {
  document: DocumentRef;

  operation: DocumentOperationDescriptor;

  policy: ProcessingPolicy;

  device?: DeviceCapabilities;

  complexity?: DocumentComplexity;
}
