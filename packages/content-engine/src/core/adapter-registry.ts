import type {
  DocumentFormatAdapter,
  DocumentSourceAdapter,
} from '../contracts/adapters';
import type { DocumentRef } from '../contracts/document-ref';

/**
 * Resolves the source/format adapters for a document.
 *
 * Source selection is driven by `DocumentSourceAdapter.supports(ref)`;
 * format selection is driven by `DocumentFormatAdapter.detect(binary)` once
 * the source bytes are available. Concrete registries wire these lookups.
 */
export interface AdapterRegistry {
  formatAdapterFor(document: DocumentRef): DocumentFormatAdapter | undefined;
  sourceAdapterFor(document: DocumentRef): DocumentSourceAdapter | undefined;
  readonly formatAdapters: readonly DocumentFormatAdapter[];
  readonly sourceAdapters: readonly DocumentSourceAdapter[];
}
