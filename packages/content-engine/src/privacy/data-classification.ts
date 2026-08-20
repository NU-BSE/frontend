/**
 * Privacy classification of document content.
 *
 * The default is `user-private`: any content that came from the local
 * filesystem, Google Drive/Gmail/Calendar/Contacts, Telegram, WhatsApp,
 * OneDrive, Dropbox or another private connector is private unless explicitly
 * marked otherwise. `public` is only reachable through an explicit override,
 * never inferred from a source.
 */
import type { ContentSource, DocumentRef } from '../contracts/document-ref';

export type DataClassification =
  | 'public'
  | 'user-private'
  | 'sensitive'
  | 'credential';

/**
 * Privacy-first: every source defaults to `user-private`. Higher layers (or
 * explicit `DocumentRef.metadata.classification`) may promote to `sensitive`
 * or downgrade to `public`, but nothing infers "public" from a source name.
 */
export function classifySource(_source: ContentSource): DataClassification {
  return 'user-private';
}

/**
 * Classifies a document, honoring an explicit `metadata.classification`
 * override when present, otherwise falling back to the source default.
 */
export function classifyDocument(ref: DocumentRef): DataClassification {
  const override = ref.metadata?.classification;
  if (
    override === 'public' ||
    override === 'user-private' ||
    override === 'sensitive' ||
    override === 'credential'
  ) {
    return override;
  }
  return classifySource(ref.source);
}
