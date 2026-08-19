import * as z from 'zod/v4';
import type {
  ConnectionRecord,
  ConnectorTool,
  StoreBackedConnectorOptions,
} from '@mobile-agent/connector-core';
import {
  ConnectorError,
  StoreBackedConnector,
  str,
} from '@mobile-agent/connector-core';
import type { CredentialVault } from '@mobile-agent/credential-vault';

import { GoogleApiClient, mapGoogleError } from './google-api-client';
import type { GoogleAuthorizationBridge } from './google-authorization-bridge';
import {
  createGoogleAccessTokenProvider,
  type GoogleAccessTokenProvider,
} from './google-access-token-provider';
import type { GoogleFileSink } from './google-file-sink';
import { GmailClient } from './gmail/gmail-client';
import { createGmailTools } from './gmail/gmail-tools';
import {
  GOOGLE_CALENDAR_READONLY,
  GOOGLE_DRIVE_READONLY,
} from './scopes';

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';

const iso = z.string().min(1);

/**
 * What a completed Google authorization hands back.
 *
 * No refresh token: Google's Android identity flow returns a short-lived
 * access token, and the bridge re-mints one on demand. Kept as a plain shape
 * so this package stays free of Expo/React Native imports (it is bundled for
 * Node by the verification scripts).
 */
export interface GoogleAuthorization {
  accessToken: string;
  /** Scopes Google actually granted. */
  grantedScopes: string[];
  /** Stable Google account id (`sub` from the OpenID userinfo). */
  externalAccountId?: string;
  email?: string;
  name?: string;
}

export interface GoogleConnectorOptions extends StoreBackedConnectorOptions {
  /** Runs the Google Identity authorization flow. Absent in Node/tests. */
  authorize?: () => Promise<GoogleAuthorization>;
  /** Where identity metadata goes. Absent means "do not persist". */
  vault?: CredentialVault;
  /** Native AuthorizationClient bridge (Android). Absent in Node/tests. */
  bridge?: GoogleAuthorizationBridge;
  /** Download writer. Absent means download reports unavailability. */
  fileSink?: GoogleFileSink;
  /** Injectable fetch for tests. */
  fetchFn?: typeof fetch;
}

export const GOOGLE_CONNECTION_ID = 'google-account';

/** Pre-multi-account credential key, kept for backward-compatible disconnect. */
const LEGACY_GOOGLE_CREDENTIAL_KEY = GOOGLE_CONNECTION_ID;

function generateFallbackAccountId(): string {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `google:anon:${random}`;
}

function connectionIdForAccount(externalAccountId?: string): string {
  return externalAccountId
    ? `google:${externalAccountId}`
    : generateFallbackAccountId();
}

function credentialReferenceFor(connectionId: string): string {
  return `google.oauth:${connectionId}`;
}

/** Escape a raw user query for a safe Drive `name contains '...'` clause. */
function escapeDriveQuery(value: string): string {
  return value.replace(/([\\'])/g, '\\$1').trim();
}

function normalizeCalendarEvent(raw: Record<string, unknown>) {
  const start = raw.start as Record<string, unknown> | undefined;
  const end = raw.end as Record<string, unknown> | undefined;
  return {
    id: raw.id,
    summary: raw.summary,
    ...(raw.description !== undefined ? { description: raw.description } : {}),
    ...(raw.location !== undefined ? { location: raw.location } : {}),
    start: start?.dateTime ?? start?.date,
    end: end?.dateTime ?? end?.date,
    status: raw.status,
    ...(raw.htmlLink !== undefined ? { htmlLink: raw.htmlLink } : {}),
    ...(raw.organizer !== undefined ? { organizer: raw.organizer } : {}),
    ...(raw.attendees !== undefined ? { attendees: raw.attendees } : {}),
  };
}

function normalizeDriveFile(raw: Record<string, unknown>) {
  return {
    id: raw.id,
    name: raw.name,
    mimeType: raw.mimeType,
    ...(raw.size !== undefined ? { size: raw.size } : {}),
    ...(raw.modifiedTime !== undefined ? { modifiedTime: raw.modifiedTime } : {}),
    ...(raw.parents !== undefined ? { parents: raw.parents } : {}),
    ...(raw.webViewLink !== undefined ? { webViewLink: raw.webViewLink } : {}),
  };
}

const WORKSPACE_EXPORT_DEFAULTS: Record<string, string> = {
  'application/vnd.google-apps.document': 'application/pdf',
  'application/vnd.google-apps.spreadsheet':
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.google-apps.presentation':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.google-apps.drawing': 'application/pdf',
};

function isGoogleWorkspaceMime(mimeType: string): boolean {
  return mimeType.startsWith('application/vnd.google-apps.');
}

/**
 * Google connector: real read-only Calendar + Drive tools over the Google
 * REST API, with tokens minted on-demand via the Android AuthorizationClient.
 *
 * `partial`: Calendar/Drive reads are real; writes, Gmail, People and Tasks
 * are not implemented and are therefore not registered at all — they can
 * never report a fixture success in production.
 */
export class GoogleConnector extends StoreBackedConnector {
  readonly id = 'google' as const;
  readonly displayName = 'Google';
  readonly implementationStatus = 'partial' as const;

  private readonly authorize?: () => Promise<GoogleAuthorization>;
  private readonly vault?: CredentialVault;
  private readonly bridge?: GoogleAuthorizationBridge;
  private readonly fileSink?: GoogleFileSink;
  private readonly apiClient: GoogleApiClient;
  private readonly gmailClient: GmailClient;

  constructor(options: GoogleConnectorOptions) {
    super(options);
    if (options.authorize) this.authorize = options.authorize;
    if (options.vault) this.vault = options.vault;
    if (options.bridge) this.bridge = options.bridge;
    if (options.fileSink) this.fileSink = options.fileSink;

    const tokenProvider: GoogleAccessTokenProvider = this.bridge
      ? createGoogleAccessTokenProvider({
          connectionStore: options.store,
          ...(options.vault ? { vault: options.vault } : {}),
          bridge: this.bridge,
        })
      : {
          getValidAccessToken: async () => {
            throw new ConnectorError(
              'Google token provider is unavailable in this runtime.',
              'UNSUPPORTED',
            );
          },
        };

    this.apiClient = new GoogleApiClient({
      getAccessToken: (connectionId) =>
        tokenProvider.getValidAccessToken(connectionId),
      clearToken: (token) => this.bridge?.clearToken(token) ?? Promise.resolve(),
      ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
    });

    this.gmailClient = new GmailClient({ apiClient: this.apiClient });
  }

  async getTools(_connection: ConnectionRecord): Promise<ConnectorTool<any, any>[]> {
    const gmailTools = createGmailTools({
      client: this.gmailClient,
      ...(this.fileSink ? { fileSink: this.fileSink } : {}),
      onReauth: async (connectionId, code) => {
        await this.markConnectionStatus(connectionId, code);
      },
    });

    return [
      ...gmailTools,
      // --- Calendar (read-only) ---
      {
        name: 'google.calendar.list_events',
        title: 'List events',
        description:
          'List calendar events in a time range from the connected Google Calendar.',
        inputSchema: z.object({
          connectionId: str,
          calendarId: str.default('primary'),
          start: iso,
          end: iso,
          maxResults: z.number().int().min(1).max(100).default(20),
        }),
        risk: 'read',
        capabilities: ['google.calendar.read'],
        requiredScopes: [GOOGLE_CALENDAR_READONLY],
        implementationStatus: 'real',
        execute: async (
          input: {
            connectionId: string;
            calendarId: string;
            start: string;
            end: string;
            maxResults: number;
          },
          context,
        ) => {
          try {
            const data = await this.apiClient.requestJson(
              context.connection.id,
              'GET',
              `${CALENDAR_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events`,
              {
                query: {
                  timeMin: input.start,
                  timeMax: input.end,
                  singleEvents: 'true',
                  orderBy: 'startTime',
                  maxResults: String(input.maxResults),
                },
              },
            );
            const items = Array.isArray(data.items)
              ? data.items.map((event) =>
                  normalizeCalendarEvent(event as Record<string, unknown>),
                )
              : [];
            return {
              items,
              ...(data.nextPageToken
                ? { nextPageToken: data.nextPageToken }
                : {}),
            };
          } catch (error) {
            throw mapGoogleError(error, 'listing calendar events');
          }
        },
      },
      {
        name: 'google.calendar.get_event',
        title: 'Get event',
        description: 'Get a single calendar event by id.',
        inputSchema: z.object({
          connectionId: str,
          calendarId: str.default('primary'),
          eventId: str,
        }),
        risk: 'read',
        capabilities: ['google.calendar.read'],
        requiredScopes: [GOOGLE_CALENDAR_READONLY],
        implementationStatus: 'real',
        execute: async (
          input: { connectionId: string; calendarId: string; eventId: string },
          context,
        ) => {
          try {
            const data = await this.apiClient.requestJson(
              context.connection.id,
              'GET',
              `${CALENDAR_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
            );
            return normalizeCalendarEvent(data);
          } catch (error) {
            throw mapGoogleError(error, 'getting calendar event');
          }
        },
      },
      {
        name: 'google.calendar.check_availability',
        title: 'Check availability',
        description: 'Check free/busy for a time range on the primary calendar.',
        inputSchema: z.object({
          connectionId: str,
          start: iso,
          end: iso,
        }),
        risk: 'read',
        capabilities: ['google.calendar.read'],
        requiredScopes: [GOOGLE_CALENDAR_READONLY],
        implementationStatus: 'real',
        execute: async (
          input: { connectionId: string; start: string; end: string },
          context,
        ) => {
          try {
            const data = await this.apiClient.requestJson(
              context.connection.id,
              'POST',
              `${CALENDAR_BASE}/freeBusy`,
              {
                body: {
                  timeMin: input.start,
                  timeMax: input.end,
                  items: [{ id: 'primary' }],
                },
              },
            );
            const calendars = data.calendars as
              | Record<string, { busy?: unknown[] }>
              | undefined;
            const primary = calendars?.['primary'];
            const busy = Array.isArray(primary?.busy)
              ? primary.busy.map((block) => {
                  const b = block as Record<string, unknown>;
                  return { start: b.start, end: b.end };
                })
              : [];
            return { busy };
          } catch (error) {
            throw mapGoogleError(error, 'checking calendar availability');
          }
        },
      },

      // --- Drive (read-only) ---
      {
        name: 'google.drive.search',
        title: 'Search Drive',
        description: 'Search files in Google Drive by name.',
        inputSchema: z.object({
          connectionId: str,
          query: str,
          maxResults: z.number().int().min(1).max(100).default(20),
        }),
        risk: 'read',
        capabilities: ['google.drive.read'],
        requiredScopes: [GOOGLE_DRIVE_READONLY],
        implementationStatus: 'real',
        execute: async (
          input: { connectionId: string; query: string; maxResults: number },
          context,
        ) => {
          try {
            const q = `name contains '${escapeDriveQuery(input.query)}' and trashed = false`;
            const data = await this.apiClient.requestJson(
              context.connection.id,
              'GET',
              `${DRIVE_BASE}/files`,
              {
                query: {
                  q,
                  pageSize: String(input.maxResults),
                  supportsAllDrives: 'true',
                  includeItemsFromAllDrives: 'true',
                  fields:
                    'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,webViewLink)',
                },
              },
            );
            const files = Array.isArray(data.files)
              ? data.files.map((file) =>
                  normalizeDriveFile(file as Record<string, unknown>),
                )
              : [];
            return {
              files,
              ...(data.nextPageToken
                ? { nextPageToken: data.nextPageToken }
                : {}),
            };
          } catch (error) {
            throw mapGoogleError(error, 'searching Drive');
          }
        },
      },
      {
        name: 'google.drive.get_metadata',
        title: 'Get metadata',
        description: 'Get file/folder metadata from Google Drive.',
        inputSchema: z.object({ connectionId: str, fileId: str }),
        risk: 'read',
        capabilities: ['google.drive.read'],
        requiredScopes: [GOOGLE_DRIVE_READONLY],
        implementationStatus: 'real',
        execute: async (
          input: { connectionId: string; fileId: string },
          context,
        ) => {
          try {
            const data = await this.apiClient.requestJson(
              context.connection.id,
              'GET',
              `${DRIVE_BASE}/files/${encodeURIComponent(input.fileId)}`,
              {
                query: {
                  supportsAllDrives: 'true',
                  fields:
                    'id,name,mimeType,size,modifiedTime,parents,webViewLink,capabilities',
                },
              },
            );
            return normalizeDriveFile(data);
          } catch (error) {
            throw mapGoogleError(error, 'getting Drive metadata');
          }
        },
      },
      {
        name: 'google.drive.download',
        title: 'Download',
        description:
          'Download a file from Google Drive to local storage. Google Docs/Sheets/Slides are exported via `exportMimeType` (defaults to a printable format).',
        inputSchema: z.object({
          connectionId: str,
          fileId: str,
          exportMimeType: z.string().optional(),
        }),
        risk: 'read',
        capabilities: ['google.drive.read'],
        requiredScopes: [GOOGLE_DRIVE_READONLY],
        implementationStatus: 'real',
        execute: async (
          input: { connectionId: string; fileId: string; exportMimeType?: string },
          context,
        ) => {
          if (!this.fileSink) {
            throw new ConnectorError(
              'File download is unavailable in this runtime.',
              'UNSUPPORTED',
            );
          }
          try {
            const metadata = await this.apiClient.requestJson(
              context.connection.id,
              'GET',
              `${DRIVE_BASE}/files/${encodeURIComponent(input.fileId)}`,
              {
                query: {
                  supportsAllDrives: 'true',
                  fields: 'id,name,mimeType,capabilities',
                },
              },
            );

            const name = typeof metadata.name === 'string' ? metadata.name : 'file';
            const mimeType = typeof metadata.mimeType === 'string'
              ? metadata.mimeType
              : 'application/octet-stream';

            let downloadMimeType: string | undefined;
            let url: string;
            if (isGoogleWorkspaceMime(mimeType)) {
              // Native Google Workspace documents have no `alt=media`; export.
              downloadMimeType =
                input.exportMimeType ??
                WORKSPACE_EXPORT_DEFAULTS[mimeType] ??
                'application/pdf';
              url = `${DRIVE_BASE}/files/${encodeURIComponent(input.fileId)}/export`;
            } else {
              url = `${DRIVE_BASE}/files/${encodeURIComponent(input.fileId)}`;
            }

            const { bytes } = await this.apiClient.requestBytes(
              context.connection.id,
              'GET',
              url,
              {
                query: {
                  ...(downloadMimeType
                    ? { mimeType: downloadMimeType }
                    : { alt: 'media' }),
                },
              },
            );

            const { localUri } = await this.fileSink.saveFile({
              fileName: name,
              mimeType: downloadMimeType ?? mimeType,
              bytes,
            });

            return {
              fileId: input.fileId,
              localUri,
              name,
              mimeType: downloadMimeType ?? mimeType,
            };
          } catch (error) {
            throw mapGoogleError(error, 'downloading Drive file');
          }
        },
      },
    ];
  }

  /**
   * Sign in with Google via the Android identity flow and persist the
   * connection. Only identity metadata is stored — no refresh token and no
   * long-lived access token is written to the vault or the record.
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

    const connectionId = connectionIdForAccount(grant.externalAccountId);
    const credentialReference = credentialReferenceFor(connectionId);

    if (this.vault) {
      await this.vault.save(credentialReference, {
        kind: 'oauth',
        accessToken: grant.accessToken,
        scopes: grant.grantedScopes,
        ...(grant.email ? { accountName: grant.email } : {}),
      });
    }

    const existing = await this.store.get(connectionId);
    const record: ConnectionRecord = {
      id: connectionId,
      connectorId: this.id,
      ...(grant.externalAccountId
        ? { externalAccountId: grant.externalAccountId }
        : {}),
      displayName: grant.email ?? grant.name ?? 'Google',
      status: 'connected',
      scopes: grant.grantedScopes,
      capabilities: [
        'google.calendar.read',
        'google.drive.read',
        'google.gmail.read',
        'google.gmail.compose',
        'google.gmail.modify',
      ],
      credentialReference,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.store.save(record);
    return record;
  }

  /** Revoke access at Google and delete the local credential + record. */
  async disconnect(connectionId: string): Promise<void> {
    const record = await this.store.get(connectionId);

    const credentialReference =
      record?.credentialReference ??
      (connectionId === GOOGLE_CONNECTION_ID
        ? LEGACY_GOOGLE_CREDENTIAL_KEY
        : null);

    const stored =
      this.vault && credentialReference
        ? await this.vault.get(credentialReference)
        : null;

    const accountName =
      stored?.kind === 'oauth'
        ? stored.accountName
        : undefined;

    const scopes =
      record?.scopes ??
      (stored?.kind === 'oauth' ? stored.scopes : []);

    // Local state is authoritative for UI.
    await super.disconnect(connectionId);

    if (this.vault && credentialReference) {
      try {
        await this.vault.remove(credentialReference);
      } catch (error) {
        console.warn('[google] credential cleanup failed', error);
      }
    }

    // Remote revoke must never block local disconnect.
    if (this.bridge && (accountName || scopes.length > 0)) {
      try {
        await Promise.race([
          this.bridge.revoke({
            ...(accountName ? { accountName } : {}),
            scopes,
          }),
          new Promise<void>((_, reject) =>
            setTimeout(
              () => reject(new Error('Google revoke timed out')),
              5000,
            ),
          ),
        ]);
      } catch (error) {
        console.warn('[google] revoke failed or timed out', error);
      }
    }
  }

  /**
   * Incremental authorization: request additional Google scopes (e.g. the
   * restricted Gmail scopes) for an already-connected account, then persist
   * the merged grant. Called from the app layer in the foreground — never from
   * a background MCP execution, which must not pop a consent Activity.
   */
  async authorizeAdditionalScopes(
    connectionId: string,
    additionalScopes: string[],
  ): Promise<ConnectionRecord> {
    const record = await this.store.get(connectionId);
    if (!record) {
      throw new ConnectorError(
        `Connection "${connectionId}" was not found.`,
        'NOT_CONNECTED',
      );
    }
    if (!this.bridge) {
      throw new ConnectorError(
        'Google sign-in is unavailable in this runtime.',
        'UNSUPPORTED',
      );
    }

    let accountName: string | undefined;
    if (this.vault && record.credentialReference) {
      const credential = await this.vault.get(record.credentialReference);
      accountName =
        credential?.kind === 'oauth' ? credential.accountName : undefined;
    }

    const requested = Array.from(
      new Set([...(record.scopes ?? []), ...additionalScopes]),
    );
    const result = await this.bridge.authorize({
      scopes: requested,
      ...(accountName ? { accountName } : {}),
      selectAccount: false,
    });

    const scopes = Array.from(
      new Set([...(record.scopes ?? []), ...result.grantedScopes]),
    );
    const updated: ConnectionRecord = {
      ...record,
      scopes,
      status: 'connected',
      updatedAt: Date.now(),
    };
    await this.store.save(updated);
    return updated;
  }

  /**
   * Marks a connection as needing re-authorization when a Gmail failure shows
   * the grant is gone or consent is required. No Google UI is opened here.
   */
  private async markConnectionStatus(
    connectionId: string,
    code: 'AUTH_REQUIRED' | 'PERMISSION_REQUIRED',
  ): Promise<void> {
    const record = await this.store.get(connectionId);
    if (!record) return;
    const status =
      code === 'AUTH_REQUIRED' ? 'reconnect_required' : 'permission_required';
    await this.store.save({ ...record, status, updatedAt: Date.now() });
  }
}
