/**
 * Provenance of a piece of model context: where it came from, how it was
 * classified, and which transport produced it. Attached to every
 * `ModelContextEnvelope` so the model-routing seam can verify that private
 * content stays local.
 */
import type { ContentSource } from '../contracts/document-ref';
import type { DataClassification } from './data-classification';

export interface ContentProvenance {
  source: ContentSource;
  classification: DataClassification;
  /** Epoch ms when the content was obtained, when known. */
  obtainedAt?: number;
  /** Transport that produced the content — local or the user's provider API. */
  via: 'local' | 'provider-api';
}
