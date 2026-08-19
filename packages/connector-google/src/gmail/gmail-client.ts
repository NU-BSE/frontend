/**
 * Gmail REST client over the shared Google transport.
 *
 * It does not reimplement token handling: it wraps `GoogleApiClient`, which
 * already mints the access token via the common provider, clears a stale token
 * on 401 and retries exactly once. Gmail-specific concerns here are only the
 * base URL, the `users/me` routing, and per-request timeouts.
 */
import { GoogleApiClient } from '../google-api-client';
import type {
  GmailDraft,
  GmailDraftList,
  GmailMessage,
  GmailMessageList,
  GmailProfile,
  GmailThread,
} from './gmail-types';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1';

export interface GmailClientDeps {
  apiClient: GoogleApiClient;
  /** Per-request timeout; aborts the underlying fetch when exceeded. */
  timeoutMs?: number;
}

interface GmailRequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export interface ListMessagesParams {
  q?: string;
  maxResults?: number;
  pageToken?: string;
}

export interface ListDraftsParams {
  maxResults?: number;
  pageToken?: string;
  q?: string;
}

export interface ModifyMessageParams {
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

export interface SendDraftResult {
  id: string;
  threadId?: string;
}

export class GmailClient {
  private readonly timeoutMs: number;

  constructor(private readonly deps: GmailClientDeps) {
    this.timeoutMs = deps.timeoutMs ?? 30_000;
  }

  private async requestJson<T>(
    connectionId: string,
    method: string,
    path: string,
    options: GmailRequestOptions = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const data = await this.deps.apiClient.requestJson(
        connectionId,
        method,
        `${GMAIL_BASE}${path}`,
        {
          ...(options.query !== undefined ? { query: options.query } : {}),
          ...(options.body !== undefined ? { body: options.body } : {}),
          signal: controller.signal,
        },
      );
      return data as unknown as T;
    } finally {
      clearTimeout(timer);
    }
  }

  listMessages(
    connectionId: string,
    params: ListMessagesParams,
  ): Promise<GmailMessageList> {
    return this.requestJson(connectionId, 'GET', '/users/me/messages', {
      query: {
        ...(params.q !== undefined ? { q: params.q } : {}),
        ...(params.maxResults !== undefined
          ? { maxResults: params.maxResults }
          : {}),
        ...(params.pageToken !== undefined ? { pageToken: params.pageToken } : {}),
      },
    });
  }

  getMessage(
    connectionId: string,
    messageId: string,
    format: 'full' | 'metadata' = 'full',
  ): Promise<GmailMessage> {
    return this.requestJson(
      connectionId,
      'GET',
      `/users/me/messages/${encodeURIComponent(messageId)}`,
      { query: { format } },
    );
  }

  getThread(connectionId: string, threadId: string): Promise<GmailThread> {
    return this.requestJson(
      connectionId,
      'GET',
      `/users/me/threads/${encodeURIComponent(threadId)}`,
      { query: { format: 'full' } },
    );
  }

  listDrafts(
    connectionId: string,
    params: ListDraftsParams,
  ): Promise<GmailDraftList> {
    return this.requestJson(connectionId, 'GET', '/users/me/drafts', {
      query: {
        ...(params.maxResults !== undefined
          ? { maxResults: params.maxResults }
          : {}),
        ...(params.pageToken !== undefined ? { pageToken: params.pageToken } : {}),
        ...(params.q !== undefined ? { q: params.q } : {}),
      },
    });
  }

  getDraft(
    connectionId: string,
    draftId: string,
    format: 'full' | 'raw' = 'full',
  ): Promise<GmailDraft> {
    return this.requestJson(
      connectionId,
      'GET',
      `/users/me/drafts/${encodeURIComponent(draftId)}`,
      { query: { format } },
    );
  }

  createDraft(
    connectionId: string,
    message: { raw: string; threadId?: string },
  ): Promise<GmailDraft> {
    return this.requestJson(connectionId, 'POST', '/users/me/drafts', {
      body: { message },
    });
  }

  updateDraft(
    connectionId: string,
    draftId: string,
    message: { raw: string; threadId?: string },
  ): Promise<GmailDraft> {
    return this.requestJson(
      connectionId,
      'PUT',
      `/users/me/drafts/${encodeURIComponent(draftId)}`,
      { body: { message } },
    );
  }

  sendDraft(
    connectionId: string,
    draftId: string,
  ): Promise<SendDraftResult> {
    return this.requestJson(connectionId, 'POST', '/users/me/drafts/send', {
      body: { id: draftId },
    });
  }

  modifyMessage(
    connectionId: string,
    messageId: string,
    params: ModifyMessageParams,
  ): Promise<GmailMessage> {
    return this.requestJson(
      connectionId,
      'POST',
      `/users/me/messages/${encodeURIComponent(messageId)}/modify`,
      { body: params },
    );
  }

  getAttachment(
    connectionId: string,
    messageId: string,
    attachmentId: string,
  ): Promise<{ data: string; size: number }> {
    return this.requestJson(
      connectionId,
      'GET',
      `/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
  }

  getProfile(connectionId: string): Promise<GmailProfile> {
    return this.requestJson(connectionId, 'GET', '/users/me/profile');
  }
}
