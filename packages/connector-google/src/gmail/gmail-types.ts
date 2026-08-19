/**
 * Gmail API resource shapes (the subset the connector reads) and the
 * normalized results handed to the model. Raw Gmail responses are never
 * returned as-is: every tool reduces them to a small, typed result so the
 * model receives data, not an unbounded provider blob.
 */

// --- Raw Gmail API resources ---------------------------------------------

export interface GmailMessageList {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailMessagePartHeader {
  name: string;
  value: string;
}

export interface GmailMessagePartBody {
  size?: number;
  data?: string;
  attachmentId?: string;
}

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailMessagePartHeader[];
  body?: GmailMessagePartBody;
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailMessagePart;
  internalDate?: string;
  sizeEstimate?: number;
  historyId?: string;
  raw?: string;
}

export interface GmailDraft {
  id: string;
  message: GmailMessage;
}

export interface GmailDraftList {
  drafts?: GmailDraft[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailThread {
  id: string;
  historyId?: string;
  messages?: GmailMessage[];
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal?: number;
  threadsTotal?: number;
  historyId?: string;
}

// --- Normalized results ----------------------------------------------------

export interface GmailAttachment {
  attachmentId?: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface GmailNormalizedMessage {
  id: string;
  threadId?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  date?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  snippet?: string;
  textBody?: string;
  htmlBody?: string;
  attachments: GmailAttachment[];
  labelIds: string[];
  unread?: boolean;
}

export interface GmailSearchHit {
  id: string;
  threadId?: string;
  from?: string;
  to?: string[];
  subject?: string;
  date?: string;
  snippet?: string;
  labelIds?: string[];
  unread?: boolean;
}

export interface GmailSearchResult {
  messages: GmailSearchHit[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailDraftSummary {
  id: string;
  messageId: string;
  threadId?: string;
  to?: string[];
  subject?: string;
  snippet?: string;
}

export interface GmailDraftListResult {
  drafts: GmailDraftSummary[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailDraftPreview {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  /** Readable text body (plain text preferred, HTML converted otherwise). */
  body: string;
  textBody?: string;
  htmlBody?: string;
}

export interface GmailDraftWriteResult {
  id: string;
  messageId: string;
  threadId?: string;
  /** Hash of the stored raw MIME; send_draft verifies it to prevent TOCTOU. */
  fingerprint: string;
  preview: GmailDraftPreview;
}

// --- Security limits --------------------------------------------------------

export interface GmailLimits {
  /** Maximum `messages.list` page size. */
  maxSearchResults: number;
  /** Maximum messages a single thread read returns. */
  maxThreadMessages: number;
  /** Maximum characters of a body passed to the model (each of text/html). */
  maxBodyCharacters: number;
  /** Attachments larger than this are refused by get_attachment. */
  maxAttachmentSizeBytes: number;
  /** Per-request timeout. */
  requestTimeoutMs: number;
  /** Concurrent messages.get calls when enriching search results. */
  maxMetadataConcurrency: number;
}

export const DEFAULT_GMAIL_LIMITS: GmailLimits = {
  maxSearchResults: 50,
  maxThreadMessages: 100,
  maxBodyCharacters: 20_000,
  maxAttachmentSizeBytes: 10 * 1024 * 1024,
  requestTimeoutMs: 30_000,
  maxMetadataConcurrency: 5,
};
