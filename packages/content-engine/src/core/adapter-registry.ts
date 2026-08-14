import type {
  DocumentFormatAdapter,
  DocumentSourceAdapter,
} from '../contracts/adapters';
import type { DocumentRef } from '../contracts/document-ref';

export interface AdapterRegistry {
  formatAdapterFor(document: DocumentRef): DocumentFormatAdapter | undefined;
  sourceAdapterFor(document: DocumentRef): DocumentSourceAdapter | undefined;
  readonly formatAdapters: readonly DocumentFormatAdapter[];
  readonly sourceAdapters: readonly DocumentSourceAdapter[];
}
