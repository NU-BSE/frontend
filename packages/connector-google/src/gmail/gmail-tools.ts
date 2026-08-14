/**
 * Production Gmail tools for the Google connector.
 *
 * Every tool is `implementationStatus: 'real'`: none may report a mock
 * success. Read tools require `gmail.readonly`, draft/send require
 * `gmail.compose`, and label changes require `gmail.modify` — enforced by the
 * MCP server before `execute()` and again by the Gmail API.
 *
 * Email content is untrusted external data: it is normalized into a small,
 * typed result and returned as tool output only. Nothing here treats a body as
 * an instruction, and sending always flows through the MCP approval layer
 * (`external_side_effect`).
 */
import * as z from 'zod/v4';

import type { ConnectorTool } from '@mobile-agent/connector-core';
import { ConnectorError, str } from '@mobile-agent/connector-core';

import type { GoogleFileSink } from '../google-file-sink';
import {
  GOOGLE_GMAIL_COMPOSE,
  GOOGLE_GMAIL_MODIFY,
  GOOGLE_GMAIL_READONLY,
} from '../scopes';
import type { GmailClient } from './gmail-client';
import { mapGmailError } from './gmail-errors';
import {
  buildMimeMessage,
  computeDraftFingerprint,
  decodeBase64Url,
  encodeBase64Url,
  htmlToText,
  parseGmailPayload,
  truncateText,
} from './gmail-message';
import type {
  GmailDraftPreview,
  GmailDraftWriteResult,
  GmailLimits,
  GmailMessage,
  GmailNormalizedMessage,
  GmailSearchHit,
} from './gmail-types';
import { DEFAULT_GMAIL_LIMITS } from './gmail-types';

const READ_CAP = ['google.gmail.read'];
const COMPOSE_CAP = ['google.gmail.compose'];
const MODIFY_CAP = ['google.gmail.modify'];

export interface GmailToolsDeps {
  client: GmailClient;
  /** Attachment writer; get_attachment reports unavailability without it. */
  fileSink?: GoogleFileSink;
  /** Optional overrides for the security limits. */
  limits?: Partial<GmailLimits>;
  /**
   * Called when a Gmail failure means the grant is gone or consent is needed,
   * so the runtime can mark the connection `reconnect_required` /
   * `permission_required`. Best-effort; the mapped error is still thrown.
   */
  onReauth?: (
    connectionId: string,
    code: 'AUTH_REQUIRED' | 'PERMISSION_REQUIRED',
  ) => Promise<void>;
}

function resolveTo(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

/** textBody ?? body (backward-compatible `body` field) ?? html fallback. */
function resolveBodies(input: {
  textBody?: string;
  htmlBody?: string;
  body?: string;
}): { textBody?: string; htmlBody?: string } {
  const textBody = input.textBody ?? input.body;
  return {
    ...(textBody !== undefined ? { textBody } : {}),
    ...(input.htmlBody !== undefined ? { htmlBody: input.htmlBody } : {}),
  };
}

function normalizeMessage(
  message: GmailMessage,
  limits: GmailLimits,
): GmailNormalizedMessage {
  const parsed = parseGmailPayload(message.payload);
  const labelIds = message.labelIds ?? [];
  // Prefer text/plain; when only HTML is present, safely convert it to text so
  // the model receives readable content, never an unbounded HTML blob.
  const readableText =
    parsed.textBody ??
    (parsed.htmlBody !== undefined ? htmlToText(parsed.htmlBody) : undefined);
  return {
    id: message.id,
    ...(message.threadId !== undefined ? { threadId: message.threadId } : {}),
    ...(parsed.from !== undefined ? { from: parsed.from } : {}),
    ...(parsed.to !== undefined ? { to: parsed.to } : {}),
    ...(parsed.cc !== undefined ? { cc: parsed.cc } : {}),
    ...(parsed.bcc !== undefined ? { bcc: parsed.bcc } : {}),
    ...(parsed.subject !== undefined ? { subject: parsed.subject } : {}),
    ...(parsed.date !== undefined ? { date: parsed.date } : {}),
    ...(parsed.messageId !== undefined ? { messageId: parsed.messageId } : {}),
    ...(parsed.inReplyTo !== undefined ? { inReplyTo: parsed.inReplyTo } : {}),
    ...(parsed.references !== undefined ? { references: parsed.references } : {}),
    ...(message.snippet !== undefined ? { snippet: message.snippet } : {}),
    ...(readableText !== undefined
      ? { textBody: truncateText(readableText, limits.maxBodyCharacters) }
      : {}),
    ...(parsed.htmlBody !== undefined
      ? { htmlBody: truncateText(parsed.htmlBody, limits.maxBodyCharacters) }
      : {}),
    attachments: parsed.attachments,
    labelIds,
    unread: labelIds.includes('UNREAD'),
  };
}

function normalizeSearchHit(
  message: GmailMessage,
  limits: GmailLimits,
): GmailSearchHit {
  const parsed = parseGmailPayload(message.payload);
  const labelIds = message.labelIds ?? [];
  return {
    id: message.id,
    ...(message.threadId !== undefined ? { threadId: message.threadId } : {}),
    ...(parsed.from !== undefined ? { from: parsed.from } : {}),
    ...(parsed.to !== undefined ? { to: parsed.to } : {}),
    ...(parsed.subject !== undefined ? { subject: parsed.subject } : {}),
    ...(parsed.date !== undefined ? { date: parsed.date } : {}),
    ...(message.snippet !== undefined ? { snippet: message.snippet } : {}),
    ...(labelIds.length > 0 ? { labelIds } : {}),
    unread: labelIds.includes('UNREAD'),
  };
}

function previewBody(textBody?: string, htmlBody?: string): string {
  if (textBody !== undefined && textBody.length > 0) return textBody;
  if (htmlBody !== undefined && htmlBody.length > 0) return htmlToText(htmlBody);
  return '';
}

/** Runs up to `limit` async tasks concurrently, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) break;
        results[index] = await fn(items[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * Resolves reply headers/thread for `replyToMessageId`: `In-Reply-To` and
 * `References` keep the reply grouped in the original thread.
 */
async function resolveReplyContext(
  client: GmailClient,
  connectionId: string,
  replyToMessageId: string,
): Promise<{ inReplyTo?: string; references?: string; threadId?: string }> {
  const original = await client.getMessage(connectionId, replyToMessageId, 'full');
  const parsed = parseGmailPayload(original.payload);
  const inReplyTo = parsed.messageId;
  const references = parsed.references
    ? `${parsed.references} ${parsed.messageId}`
    : parsed.messageId;
  return {
    ...(inReplyTo !== undefined ? { inReplyTo } : {}),
    ...(references !== undefined ? { references } : {}),
    ...(original.threadId !== undefined ? { threadId: original.threadId } : {}),
  };
}

export function createGmailTools(deps: GmailToolsDeps): ConnectorTool<any, any>[] {
  const { client } = deps;
  const limits: GmailLimits = { ...DEFAULT_GMAIL_LIMITS, ...deps.limits };

  async function fail(
    connectionId: string,
    error: unknown,
    context: string,
  ): Promise<never> {
    const mapped = mapGmailError(error, context);
    if (
      deps.onReauth &&
      (mapped.code === 'AUTH_REQUIRED' || mapped.code === 'PERMISSION_REQUIRED')
    ) {
      try {
        await deps.onReauth(connectionId, mapped.code);
      } catch {
        // Best-effort status update; the mapped error below is the contract.
      }
    }
    throw mapped;
  }

  const draftPreview = (
    to: string[],
    cc: string[] | undefined,
    bcc: string[] | undefined,
    subject: string,
    textBody: string | undefined,
    htmlBody: string | undefined,
  ): GmailDraftPreview => ({
    to,
    ...(cc && cc.length > 0 ? { cc } : {}),
    ...(bcc && bcc.length > 0 ? { bcc } : {}),
    subject,
    body: previewBody(textBody, htmlBody),
    ...(textBody !== undefined ? { textBody } : {}),
    ...(htmlBody !== undefined ? { htmlBody } : {}),
  });

  // --- search ---------------------------------------------------------------
  const search: ConnectorTool = {
    name: 'google.gmail.search',
    title: 'Search Gmail',
    description:
      'Search Gmail messages using Gmail search syntax (e.g. "from:alice@example.com newer_than:7d is:unread").',
    inputSchema: z.object({
      connectionId: str,
      query: str,
      maxResults: z.number().int().min(1).max(50).default(20),
    }),
    risk: 'read',
    capabilities: READ_CAP,
    requiredScopes: [GOOGLE_GMAIL_READONLY],
    implementationStatus: 'real',
    execute: async (
      input: { connectionId: string; query: string; maxResults: number },
      context,
    ) => {
      try {
        const pageSize = Math.min(input.maxResults, limits.maxSearchResults);
        const list = await client.listMessages(context.connection.id, {
          q: input.query,
          maxResults: pageSize,
        });

        const summaries = list.messages ?? [];
        const hits = await mapWithConcurrency(
          summaries,
          limits.maxMetadataConcurrency,
          async (summary) => {
            try {
              const message = await client.getMessage(
                context.connection.id,
                summary.id,
                'metadata',
              );
              return normalizeSearchHit(message, limits);
            } catch (error) {
              const mapped = mapGmailError(error, 'searching Gmail');
              // A message removed between list and get is not a failure.
              if (mapped.code === 'NOT_FOUND') {
                return {
                  id: summary.id,
                  ...(summary.threadId !== undefined
                    ? { threadId: summary.threadId }
                    : {}),
                };
              }
              throw mapped;
            }
          },
        );

        return {
          messages: hits,
          ...(list.nextPageToken !== undefined
            ? { nextPageToken: list.nextPageToken }
            : {}),
          ...(list.resultSizeEstimate !== undefined
            ? { resultSizeEstimate: list.resultSizeEstimate }
            : {}),
        };
      } catch (error) {
        return fail(context.connection.id, error, 'searching Gmail');
      }
    },
  };

  // --- get_message ----------------------------------------------------------
  const getMessage: ConnectorTool = {
    name: 'google.gmail.get_message',
    title: 'Read message',
    description: 'Read a full Gmail message by id, including parsed body text.',
    inputSchema: z.object({ connectionId: str, messageId: str }),
    risk: 'read',
    capabilities: READ_CAP,
    requiredScopes: [GOOGLE_GMAIL_READONLY],
    implementationStatus: 'real',
    execute: async (
      input: { connectionId: string; messageId: string },
      context,
    ) => {
      try {
        const message = await client.getMessage(
          context.connection.id,
          input.messageId,
          'full',
        );
        return normalizeMessage(message, limits);
      } catch (error) {
        return fail(context.connection.id, error, 'reading Gmail message');
      }
    },
  };

  // --- get_thread -----------------------------------------------------------
  const getThread: ConnectorTool = {
    name: 'google.gmail.get_thread',
    title: 'Read thread',
    description: 'Read an entire Gmail conversation thread by thread id.',
    inputSchema: z.object({
      connectionId: str,
      threadId: str,
      maxMessages: z.number().int().min(1).max(100).default(100),
    }),
    risk: 'read',
    capabilities: READ_CAP,
    requiredScopes: [GOOGLE_GMAIL_READONLY],
    implementationStatus: 'real',
    execute: async (
      input: { connectionId: string; threadId: string; maxMessages: number },
      context,
    ) => {
      try {
        const thread = await client.getThread(context.connection.id, input.threadId);
        const messages = (thread.messages ?? [])
          .slice(0, Math.min(input.maxMessages, limits.maxThreadMessages))
          .map((message) => normalizeMessage(message, limits));
        return {
          id: thread.id,
          ...(thread.historyId !== undefined ? { historyId: thread.historyId } : {}),
          messages,
        };
      } catch (error) {
        return fail(context.connection.id, error, 'reading Gmail thread');
      }
    },
  };

  // --- list_drafts ----------------------------------------------------------
  const listDrafts: ConnectorTool = {
    name: 'google.gmail.list_drafts',
    title: 'List drafts',
    description: 'List Gmail draft messages.',
    inputSchema: z.object({
      connectionId: str,
      maxResults: z.number().int().min(1).max(100).default(20),
      pageToken: z.string().optional(),
      query: z.string().optional(),
    }),
    risk: 'read',
    capabilities: READ_CAP,
    requiredScopes: [GOOGLE_GMAIL_READONLY],
    implementationStatus: 'real',
    execute: async (
      input: {
        connectionId: string;
        maxResults: number;
        pageToken?: string;
        query?: string;
      },
      context,
    ) => {
      try {
        const list = await client.listDrafts(context.connection.id, {
          maxResults: input.maxResults,
          ...(input.pageToken !== undefined ? { pageToken: input.pageToken } : {}),
          ...(input.query !== undefined ? { q: input.query } : {}),
        });
        const drafts = (list.drafts ?? []).map((draft) => {
          const parsed = parseGmailPayload(draft.message.payload);
          return {
            id: draft.id,
            messageId: draft.message.id,
            ...(draft.message.threadId !== undefined
              ? { threadId: draft.message.threadId }
              : {}),
            ...(parsed.to !== undefined ? { to: parsed.to } : {}),
            ...(parsed.subject !== undefined ? { subject: parsed.subject } : {}),
            ...(draft.message.snippet !== undefined
              ? { snippet: draft.message.snippet }
              : {}),
          };
        });
        return {
          drafts,
          ...(list.nextPageToken !== undefined
            ? { nextPageToken: list.nextPageToken }
            : {}),
          ...(list.resultSizeEstimate !== undefined
            ? { resultSizeEstimate: list.resultSizeEstimate }
            : {}),
        };
      } catch (error) {
        return fail(context.connection.id, error, 'listing Gmail drafts');
      }
    },
  };

  // --- create_draft ---------------------------------------------------------
  const createDraft: ConnectorTool = {
    name: 'google.gmail.create_draft',
    title: 'Create draft',
    description:
      'Create a Gmail draft (does not send). Use `replyToMessageId` to draft a reply in the same thread.',
    inputSchema: z.object({
      connectionId: str,
      to: z.union([str, z.array(str)]),
      cc: z.array(str).optional(),
      bcc: z.array(str).optional(),
      subject: str,
      textBody: z.string().optional(),
      htmlBody: z.string().optional(),
      body: z.string().optional(),
      replyToMessageId: z.string().optional(),
    }),
    risk: 'write',
    capabilities: COMPOSE_CAP,
    requiredScopes: [GOOGLE_GMAIL_COMPOSE],
    implementationStatus: 'real',
    execute: async (
      input: {
        connectionId: string;
        to: string | string[];
        cc?: string[];
        bcc?: string[];
        subject: string;
        textBody?: string;
        htmlBody?: string;
        body?: string;
        replyToMessageId?: string;
      },
      context,
    ): Promise<GmailDraftWriteResult> => {
      try {
        const to = resolveTo(input.to);
        const bodies = resolveBodies(input);

        const reply = input.replyToMessageId
          ? await resolveReplyContext(
              client,
              context.connection.id,
              input.replyToMessageId,
            )
          : {};

        const raw = encodeBase64Url(
          buildMimeMessage({
            to,
            ...(input.cc !== undefined ? { cc: input.cc } : {}),
            ...(input.bcc !== undefined ? { bcc: input.bcc } : {}),
            subject: input.subject,
            ...(bodies.textBody !== undefined ? { textBody: bodies.textBody } : {}),
            ...(bodies.htmlBody !== undefined ? { htmlBody: bodies.htmlBody } : {}),
            ...(reply.inReplyTo !== undefined ? { inReplyTo: reply.inReplyTo } : {}),
            ...(reply.references !== undefined
              ? { references: reply.references }
              : {}),
          }),
        );

        const draft = await client.createDraft(context.connection.id, {
          raw,
          ...(reply.threadId !== undefined ? { threadId: reply.threadId } : {}),
        });

        return {
          id: draft.id,
          messageId: draft.message.id,
          ...(draft.message.threadId !== undefined
            ? { threadId: draft.message.threadId }
            : {}),
          fingerprint: computeDraftFingerprint({
            to,
            ...(input.cc !== undefined ? { cc: input.cc } : {}),
            ...(input.bcc !== undefined ? { bcc: input.bcc } : {}),
            subject: input.subject,
            ...(bodies.textBody !== undefined ? { textBody: bodies.textBody } : {}),
            ...(bodies.htmlBody !== undefined ? { htmlBody: bodies.htmlBody } : {}),
          }),
          preview: draftPreview(
            to,
            input.cc,
            input.bcc,
            input.subject,
            bodies.textBody,
            bodies.htmlBody,
          ),
        };
      } catch (error) {
        return fail(context.connection.id, error, 'creating Gmail draft');
      }
    },
  };

  // --- update_draft ---------------------------------------------------------
  const updateDraft: ConnectorTool = {
    name: 'google.gmail.update_draft',
    title: 'Update draft',
    description:
      'Replace an existing Gmail draft. Omitted fields keep their current values; provided fields overwrite.',
    inputSchema: z.object({
      connectionId: str,
      draftId: str,
      to: z.union([str, z.array(str)]).optional(),
      cc: z.array(str).optional(),
      bcc: z.array(str).optional(),
      subject: z.string().optional(),
      textBody: z.string().optional(),
      htmlBody: z.string().optional(),
      body: z.string().optional(),
    }),
    risk: 'write',
    capabilities: COMPOSE_CAP,
    requiredScopes: [GOOGLE_GMAIL_COMPOSE],
    implementationStatus: 'real',
    execute: async (
      input: {
        connectionId: string;
        draftId: string;
        to?: string | string[];
        cc?: string[];
        bcc?: string[];
        subject?: string;
        textBody?: string;
        htmlBody?: string;
        body?: string;
      },
      context,
    ): Promise<GmailDraftWriteResult> => {
      try {
        const existing = await client.getDraft(
          context.connection.id,
          input.draftId,
          'full',
        );
        const parsed = parseGmailPayload(existing.message.payload);

        const to = input.to !== undefined ? resolveTo(input.to) : (parsed.to ?? []);
        const cc = input.cc ?? parsed.cc;
        const bcc = input.bcc ?? parsed.bcc;
        const subject = input.subject ?? parsed.subject ?? '';
        const bodies = resolveBodies(input);
        const textBody = bodies.textBody ?? parsed.textBody;
        const htmlBody = bodies.htmlBody ?? parsed.htmlBody;

        const raw = encodeBase64Url(
          buildMimeMessage({
            to,
            ...(cc !== undefined ? { cc } : {}),
            ...(bcc !== undefined ? { bcc } : {}),
            subject,
            ...(textBody !== undefined ? { textBody } : {}),
            ...(htmlBody !== undefined ? { htmlBody } : {}),
            ...(parsed.inReplyTo !== undefined
              ? { inReplyTo: parsed.inReplyTo }
              : {}),
            ...(parsed.references !== undefined
              ? { references: parsed.references }
              : {}),
          }),
        );

        const draft = await client.updateDraft(context.connection.id, input.draftId, {
          raw,
          ...(existing.message.threadId !== undefined
            ? { threadId: existing.message.threadId }
            : {}),
        });

        return {
          id: draft.id,
          messageId: draft.message.id,
          ...(draft.message.threadId !== undefined
            ? { threadId: draft.message.threadId }
            : {}),
          fingerprint: computeDraftFingerprint({
            to,
            ...(cc !== undefined ? { cc } : {}),
            ...(bcc !== undefined ? { bcc } : {}),
            subject,
            ...(textBody !== undefined ? { textBody } : {}),
            ...(htmlBody !== undefined ? { htmlBody } : {}),
          }),
          preview: draftPreview(to, cc, bcc, subject, textBody, htmlBody),
        };
      } catch (error) {
        return fail(context.connection.id, error, 'updating Gmail draft');
      }
    },
  };

  // --- send_draft -----------------------------------------------------------
  const sendDraft: ConnectorTool = {
    name: 'google.gmail.send_draft',
    title: 'Send draft',
    description:
      'Send an existing draft. Requires the draft to be unchanged since it was approved — its content fingerprint is verified again immediately before sending.',
    inputSchema: z.object({
      connectionId: str,
      draftId: str,
      fingerprint: str,
      to: z.array(str),
      subject: str,
      body: z.string(),
      cc: z.array(str).optional(),
      bcc: z.array(str).optional(),
    }),
    risk: 'external_side_effect',
    capabilities: COMPOSE_CAP,
    requiredScopes: [GOOGLE_GMAIL_COMPOSE],
    implementationStatus: 'real',
    execute: async (
      input: {
        connectionId: string;
        draftId: string;
        fingerprint: string;
        to: string[];
        subject: string;
        body: string;
        cc?: string[];
        bcc?: string[];
      },
      context,
    ) => {
      try {
        const current = await client.getDraft(
          context.connection.id,
          input.draftId,
          'full',
        );
        const parsed = parseGmailPayload(current.message.payload);

        const fingerprint = computeDraftFingerprint({
          to: parsed.to ?? [],
          ...(parsed.cc !== undefined ? { cc: parsed.cc } : {}),
          ...(parsed.bcc !== undefined ? { bcc: parsed.bcc } : {}),
          subject: parsed.subject ?? '',
          ...(parsed.textBody !== undefined ? { textBody: parsed.textBody } : {}),
          ...(parsed.htmlBody !== undefined ? { htmlBody: parsed.htmlBody } : {}),
        });

        if (fingerprint !== input.fingerprint) {
          throw new ConnectorError(
            'This draft changed after it was approved. Please review the draft again and re-confirm sending.',
            'VALIDATION_FAILED',
          );
        }

        const body = previewBody(parsed.textBody, parsed.htmlBody);
        const toMatch =
          JSON.stringify(input.to) === JSON.stringify(parsed.to ?? []);
        if (
          input.subject !== (parsed.subject ?? '') ||
          input.body !== body ||
          !toMatch
        ) {
          throw new ConnectorError(
            'The draft no longer matches the approved content. Please review it and re-confirm.',
            'VALIDATION_FAILED',
          );
        }

        const sent = await client.sendDraft(context.connection.id, input.draftId);
        return {
          sent: true,
          messageId: sent.id,
          ...(sent.threadId !== undefined ? { threadId: sent.threadId } : {}),
        };
      } catch (error) {
        return fail(context.connection.id, error, 'sending Gmail draft');
      }
    },
  };

  // --- archive --------------------------------------------------------------
  const archive: ConnectorTool = {
    name: 'google.gmail.archive',
    title: 'Archive message',
    description: 'Archive a Gmail message (removes the INBOX label).',
    inputSchema: z.object({ connectionId: str, messageId: str }),
    risk: 'write',
    capabilities: MODIFY_CAP,
    requiredScopes: [GOOGLE_GMAIL_MODIFY],
    implementationStatus: 'real',
    execute: async (
      input: { connectionId: string; messageId: string },
      context,
    ) => {
      try {
        const message = await client.modifyMessage(
          context.connection.id,
          input.messageId,
          { removeLabelIds: ['INBOX'] },
        );
        return {
          id: message.id,
          ...(message.threadId !== undefined ? { threadId: message.threadId } : {}),
          labelIds: message.labelIds ?? [],
        };
      } catch (error) {
        return fail(context.connection.id, error, 'archiving Gmail message');
      }
    },
  };

  // --- mark_read ------------------------------------------------------------
  const markRead: ConnectorTool = {
    name: 'google.gmail.mark_read',
    title: 'Mark as read',
    description: 'Mark a Gmail message as read (removes the UNREAD label).',
    inputSchema: z.object({ connectionId: str, messageId: str }),
    risk: 'write',
    capabilities: MODIFY_CAP,
    requiredScopes: [GOOGLE_GMAIL_MODIFY],
    implementationStatus: 'real',
    execute: async (
      input: { connectionId: string; messageId: string },
      context,
    ) => {
      try {
        const message = await client.modifyMessage(
          context.connection.id,
          input.messageId,
          { removeLabelIds: ['UNREAD'] },
        );
        return {
          id: message.id,
          ...(message.threadId !== undefined ? { threadId: message.threadId } : {}),
          labelIds: message.labelIds ?? [],
        };
      } catch (error) {
        return fail(context.connection.id, error, 'marking Gmail message read');
      }
    },
  };

  // --- get_attachment -------------------------------------------------------
  const getAttachment: ConnectorTool = {
    name: 'google.gmail.get_attachment',
    title: 'Download attachment',
    description: 'Download a Gmail attachment to local storage by attachment id.',
    inputSchema: z.object({
      connectionId: str,
      messageId: str,
      attachmentId: str,
      filename: z.string().optional(),
    }),
    risk: 'read',
    capabilities: READ_CAP,
    requiredScopes: [GOOGLE_GMAIL_READONLY],
    implementationStatus: 'real',
    execute: async (
      input: {
        connectionId: string;
        messageId: string;
        attachmentId: string;
        filename?: string;
      },
      context,
    ) => {
      if (!deps.fileSink) {
        throw new ConnectorError(
          'Attachment download is unavailable in this runtime.',
          'UNSUPPORTED',
        );
      }
      try {
        const attachment = await client.getAttachment(
          context.connection.id,
          input.messageId,
          input.attachmentId,
        );

        if (attachment.size > limits.maxAttachmentSizeBytes) {
          throw new ConnectorError(
            `Attachment exceeds the ${limits.maxAttachmentSizeBytes} byte limit and was not downloaded.`,
            'VALIDATION_FAILED',
          );
        }

        const bytes = decodeBase64Url(attachment.data);
        const filename = input.filename ?? `attachment-${input.attachmentId}`;
        const { localUri } = await deps.fileSink.saveFile({
          fileName: filename,
          mimeType: 'application/octet-stream',
          bytes,
        });

        return {
          messageId: input.messageId,
          attachmentId: input.attachmentId,
          filename,
          size: attachment.size,
          localUri,
        };
      } catch (error) {
        return fail(context.connection.id, error, 'downloading Gmail attachment');
      }
    },
  };

  return [
    search,
    getMessage,
    getThread,
    listDrafts,
    createDraft,
    updateDraft,
    sendDraft,
    archive,
    markRead,
    getAttachment,
  ];
}
