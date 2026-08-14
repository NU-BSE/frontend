/**
 * Attachment picking for the chat composer.
 *
 * Thin, platform-facing helper that turns an `expo-document-picker` result
 * into the normalized `ChatAttachment` contract. The actual policy (limits,
 * classification, safety) lives in `attachmentPolicy.ts` and is kept free of
 * platform imports so it can be unit-tested in Node.
 */
import * as DocumentPicker from 'expo-document-picker';

import type { ChatAttachment } from '@/agent/types';
import {
  attachmentValidationError,
  classifyAttachmentKind,
} from './attachmentPolicy';

function normalizeAsset(
  asset: DocumentPicker.DocumentPickerAsset,
): ChatAttachment | null {
  const name = asset.name || 'attachment';
  const mimeType = asset.mimeType || 'application/octet-stream';
  const size = asset.size ?? 0;

  if (attachmentValidationError(name, mimeType, size)) return null;

  return {
    id: `attach_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    name,
    mimeType,
    size,
    kind: classifyAttachmentKind(mimeType),
    uri: asset.uri,
  };
}

export interface PickResult {
  attachments: ChatAttachment[];
  /** Non-empty when the pick was blocked (unsupported/oversized/cancelled). */
  error: string | null;
  /** Rejected file names, so the UI can name what was skipped. */
  rejected: string[];
}

/**
 * Opens the native document picker (multiple selection) and normalizes the
 * result to `ChatAttachment[]`, rejecting unsafe/oversized files with a clear
 * message. Never throws — the UI can always render the outcome.
 */
export async function pickAttachments(): Promise<PickResult> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: '*/*',
    });

    if (result.canceled) return { attachments: [], error: null, rejected: [] };

    const attachments: ChatAttachment[] = [];
    const rejected: string[] = [];
    for (const asset of result.assets) {
      const normalized = normalizeAsset(asset);
      if (normalized) attachments.push(normalized);
      else rejected.push(asset.name);
    }

    return {
      attachments,
      rejected,
      error:
        rejected.length > 0
          ? `${rejected.join(', ')} skipped (unsupported or too large).`
          : null,
    };
  } catch {
    return {
      attachments: [],
      rejected: [],
      error: 'Could not open the file picker. Please try again.',
    };
  }
}
