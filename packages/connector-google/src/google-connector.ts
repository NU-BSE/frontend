import * as z from 'zod/v4';
import type {
  ConnectionRecord,
  ConnectorTool,
  StoreBackedConnectorOptions,
} from '@mobile-agent/connector-core';
import {
  ConnectorError,
  StoreBackedConnector,
  connId,
  dt,
  opt,
  str,
  t,
} from '@mobile-agent/connector-core';
import type { CredentialVault } from '@mobile-agent/credential-vault';

const calRead = [
  t('google.calendar.list_events', 'List events', 'List calendar events in a range', 'read',
    z.object({ connectionId: str, calendarId: str.default('primary'), start: dt, end: dt, maxResults: z.number().int().min(1).max(100).default(20) }),
    { items: [{ id: 'ev1', summary: 'Team standup', start: { dateTime: '2026-08-07T10:00:00+05:00' }, end: { dateTime: '2026-08-07T11:00:00+05:00' } }] }),
  t('google.calendar.get_event', 'Get event', 'Get a single calendar event', 'read',
    z.object({ connectionId: str, calendarId: str.default('primary'), eventId: str }),
    { id: 'ev1', summary: 'Team standup', start: { dateTime: '2026-08-07T10:00:00+05:00' }, end: { dateTime: '2026-08-07T11:00:00+05:00' } }),
  t('google.calendar.check_availability', 'Check availability', 'Check free/busy for a time range', 'read',
    z.object({ connectionId: str, start: dt, end: dt }),
    { busy: [{ start: '2026-08-07T10:00:00+05:00', end: '2026-08-07T11:00:00+05:00' }] }),
];
const calWrite = [
  t('google.calendar.create_event', 'Create event', 'Create a new calendar event', 'write',
    z.object({ connectionId: str, calendarId: str.default('primary'), title: str, start: dt, end: dt, description: opt, attendees: z.array(z.object({ email: str })).optional(), location: opt }),
    { id: 'ev2', status: 'confirmed' }),
  t('google.calendar.update_event', 'Update event', 'Update an existing event', 'write',
    z.object({ connectionId: str, calendarId: str.default('primary'), eventId: str, title: opt, start: opt, end: opt, description: opt, location: opt }),
    { id: 'ev1', status: 'updated' }),
  t('google.calendar.delete_event', 'Delete event', 'Delete a calendar event', 'destructive',
    z.object({ connectionId: str, calendarId: str.default('primary'), eventId: str }),
    { deleted: true }),
];

const gmailRead = [
  t('google.gmail.search', 'Search mail', 'Search Gmail messages', 'read',
    z.object({ connectionId: str, query: str, maxResults: z.number().int().min(1).max(50).default(10) }),
    { messages: [{ id: 'm1', threadId: 't1' }] }),
  t('google.gmail.get_message', 'Get message', 'Get full message content', 'read',
    z.object({ connectionId: str, messageId: str }),
    { id: 'm1', threadId: 't1', from: 'sender@example.com', subject: 'Hello', snippet: 'Hi there...', payload: { body: { data: 'SGk=' } } }),
  t('google.gmail.get_thread', 'Get thread', 'Get all messages in a thread', 'read',
    z.object({ connectionId: str, threadId: str }),
    { id: 't1', messages: [{ id: 'm1', snippet: 'Hi' }, { id: 'm2', snippet: 'Re: Hi' }] }),
  t('google.gmail.list_drafts', 'List drafts', 'List email drafts', 'read',
    z.object({ connectionId: str, maxResults: z.number().int().min(1).max(50).default(10) }),
    { drafts: [{ id: 'd1', message: { id: 'dm1', threadId: 't1' } }] }),
];
const gmailWrite = [
  t('google.gmail.create_draft', 'Create draft', 'Create an email draft', 'write',
    z.object({ connectionId: str, to: str, subject: str, body: str }),
    { id: 'd2', status: 'draft' }),
  t('google.gmail.update_draft', 'Update draft', 'Update an existing draft', 'write',
    z.object({ connectionId: str, draftId: str, to: opt, subject: opt, body: opt }),
    { id: 'd1', status: 'updated' }),
];
const gmailExt = [
  t('google.gmail.send_draft', 'Send draft', 'Send an existing draft', 'external_side_effect',
    z.object({ connectionId: str, draftId: str }),
    { id: 'd1', status: 'sent' }),
  t('google.gmail.archive', 'Archive', 'Archive a message', 'write',
    z.object({ connectionId: str, messageId: str }),
    { archived: true }),
  t('google.gmail.mark_read', 'Mark read', 'Mark a message as read', 'write',
    z.object({ connectionId: str, messageId: str }),
    { read: true }),
];

const drive = [
  t('google.drive.search', 'Search Drive', 'Search files in Google Drive', 'read',
    z.object({ connectionId: str, query: str, maxResults: z.number().int().min(1).max(100).default(20) }),
    { files: [{ id: 'f1', name: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 102400 }] }),
  t('google.drive.get_metadata', 'Get metadata', 'Get file/folder metadata', 'read',
    z.object({ connectionId: str, fileId: str }),
    { id: 'f1', name: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 102400 }),
  t('google.drive.download', 'Download', 'Download a file', 'read',
    z.object({ connectionId: str, fileId: str }),
    { fileId: 'f1', localUri: 'file://mock/report.pdf', name: 'report.pdf', mimeType: 'application/pdf' }),
  t('google.drive.upload', 'Upload', 'Upload a file to Drive', 'write',
    z.object({ connectionId: str, name: str, mimeType: str, parentFolderId: opt }),
    { id: 'f2', name: 'uploaded.txt' }),
  t('google.drive.create_folder', 'Create folder', 'Create a new folder', 'write',
    z.object({ connectionId: str, name: str, parentFolderId: opt }),
    { id: 'folder1', name: 'New Folder' }),
  t('google.drive.share', 'Share', 'Share a file/folder', 'external_side_effect',
    z.object({ connectionId: str, fileId: str, email: str, role: str.default('reader') }),
    { shared: true, permissionId: 'p1' }),
  t('google.drive.delete', 'Delete', 'Move file to trash', 'destructive',
    z.object({ connectionId: str, fileId: str }),
    { deleted: true }),
];

const people = [
  t('google.people.search', 'Search contacts', 'Search Google contacts', 'read',
    z.object({ connectionId: str, query: str }),
    { results: [{ resourceName: 'p1', names: [{ displayName: 'Daniyar' }], emailAddresses: [{ value: 'd@example.com' }] }] }),
  t('google.people.get', 'Get contact', 'Get a single contact', 'read',
    z.object({ connectionId: str, resourceName: str }),
    { resourceName: 'p1', names: [{ displayName: 'Daniyar' }], emailAddresses: [{ value: 'd@example.com' }] }),
  t('google.people.create', 'Create contact', 'Create a new contact', 'write',
    z.object({ connectionId: str, givenName: str, familyName: opt, email: opt, phone: opt }),
    { resourceName: 'p2', names: [{ displayName: 'New Contact' }] }),
  t('google.people.update', 'Update contact', 'Update an existing contact', 'write',
    z.object({ connectionId: str, resourceName: str, givenName: opt, familyName: opt, email: opt, phone: opt }),
    { resourceName: 'p1', updated: true }),
  t('google.people.delete', 'Delete contact', 'Delete a contact', 'destructive',
    z.object({ connectionId: str, resourceName: str }),
    { deleted: true }),
];

const tasks = [
  t('google.tasks.list_tasklists', 'List task lists', 'List all task lists', 'read',
    z.object({ connectionId: str }),
    { items: [{ id: 'tl1', title: 'Work' }] }),
  t('google.tasks.list', 'List tasks', 'List tasks in a task list', 'read',
    z.object({ connectionId: str, tasklistId: str.default('@default'), maxResults: z.number().int().min(1).max(100).default(20) }),
    { items: [{ id: 't1', title: 'Review PR', status: 'needsAction' }] }),
  t('google.tasks.create', 'Create task', 'Create a new task', 'write',
    z.object({ connectionId: str, tasklistId: str.default('@default'), title: str, notes: opt, due: opt }),
    { id: 't2', title: 'New task', status: 'needsAction' }),
  t('google.tasks.update', 'Update task', 'Update an existing task', 'write',
    z.object({ connectionId: str, tasklistId: str.default('@default'), taskId: str, title: opt, notes: opt, due: opt }),
    { id: 't1', status: 'updated' }),
  t('google.tasks.complete', 'Complete task', 'Mark a task as completed', 'write',
    z.object({ connectionId: str, tasklistId: str.default('@default'), taskId: str }),
    { id: 't1', status: 'completed' }),
  t('google.tasks.delete', 'Delete task', 'Delete a task', 'destructive',
    z.object({ connectionId: str, tasklistId: str.default('@default'), taskId: str }),
    { deleted: true }),
];

/**
 * What a completed Google authorization hands back.
 *
 * Kept as a plain shape so this package stays free of Expo and React Native
 * imports — it is bundled for Node by the verification scripts, and importing
 * `expo-auth-session` here would break them. The app injects the real
 * implementation; tests inject a fake.
 */
export interface GoogleAuthorization {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  scopes: string[];
  tokenType?: string;
  email?: string;
  name?: string;
}

export interface GoogleConnectorOptions extends StoreBackedConnectorOptions {
  /** Runs the OAuth flow. Absent in Node and in tests. */
  authorize?: () => Promise<GoogleAuthorization>;
  /** Where the tokens go. Absent means "do not persist secrets". */
  vault?: CredentialVault;
  /** Best-effort revocation on disconnect. */
  revoke?: (token: string) => Promise<void>;
}

export const GOOGLE_CONNECTION_ID = 'google-account';

export class GoogleConnector extends StoreBackedConnector {
  readonly id = 'google' as const;
  readonly displayName = 'Google';

  private readonly authorize?: () => Promise<GoogleAuthorization>;
  private readonly vault?: CredentialVault;
  private readonly revoke?: (token: string) => Promise<void>;

  constructor(options: GoogleConnectorOptions) {
    super(options);
    if (options.authorize) this.authorize = options.authorize;
    if (options.vault) this.vault = options.vault;
    if (options.revoke) this.revoke = options.revoke;
  }

  /*
   * Still `mock` until the tools call the real API: the connector can now
   * obtain a genuine grant, but every tool below returns a fixture. Claiming
   * `implemented` here would let the production registry publish tools that
   * report fake success, which is the exact failure this flag exists to stop.
   */
  readonly implementationStatus = 'mock' as const;

  async getTools(_c: ConnectionRecord) {
    return [...calRead, ...calWrite, ...gmailRead, ...gmailWrite, ...gmailExt, ...drive, ...people, ...tasks];
  }

  /**
   * Sign in with Google and persist the connection.
   *
   * Tokens are written to the credential vault, which on Android wraps them
   * with a non-exportable Keystore key; only ciphertext is stored. They are
   * never sent to the Creepy.IM backend, so the server never learns which
   * Google account — or indeed whether any — is linked. The ConnectionRecord
   * itself holds no secret, only the account label and granted scopes.
   */
  async connect(): Promise<ConnectionRecord> {
    if (!this.authorize) {
      throw new ConnectorError(
        'Google sign-in is unavailable in this runtime.',
        'UNSUPPORTED',
      );
    }

    const grant = await this.authorize();
    const now = Date.now();

    if (this.vault) {
      await this.vault.save(GOOGLE_CONNECTION_ID, {
        kind: 'oauth',
        accessToken: grant.accessToken,
        scopes: grant.scopes,
        ...(grant.refreshToken ? { refreshToken: grant.refreshToken } : {}),
        ...(grant.accessTokenExpiresAt
          ? { accessTokenExpiresAt: grant.accessTokenExpiresAt }
          : {}),
        ...(grant.tokenType ? { tokenType: grant.tokenType } : {}),
      });
    }

    const existing = await this.store.get(GOOGLE_CONNECTION_ID);
    const record: ConnectionRecord = {
      id: GOOGLE_CONNECTION_ID,
      connectorId: this.id,
      displayName: grant.email ?? grant.name ?? 'Google',
      status: 'connected',
      scopes: grant.scopes,
      capabilities: ['google.read'],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.store.save(record);
    return record;
  }

  /** Revoke at Google and delete the local credential before forgetting it. */
  async disconnect(connectionId: string): Promise<void> {
    if (this.vault && this.revoke) {
      const stored = await this.vault.get(connectionId);
      if (stored?.kind === 'oauth') {
        await this.revoke(stored.refreshToken ?? stored.accessToken);
      }
    }
    await this.vault?.remove(connectionId);
    await super.disconnect(connectionId);
  }
}
