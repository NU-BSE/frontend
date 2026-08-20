/**
 * Google connector verification (production read-only Calendar + Drive).
 *
 * Uses an injected fake AuthorizationClient bridge, fake fetch and fake file
 * sink so the Google REST layer is exercised deterministically without a real
 * account.
 *
 * Run: npm run verify:google
 */
import { ConnectorRegistry } from '@mobile-agent/connector-registry';
import {
  GoogleConnector,
  GoogleApiError,
  GOOGLE_CALENDAR_READONLY,
  GOOGLE_DRIVE_READONLY,
  type GoogleAuthorizationBridge,
  type GoogleFileSink,
} from '@mobile-agent/connector-google';
import {
  InMemoryConnectionStore,
  type ConnectionRecord,
  type ConnectorTool,
  type ToolExecutionContext,
} from '@mobile-agent/connector-core';
import { InMemoryCredentialVault } from '@mobile-agent/credential-vault';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok — ${message}`);
}

function assertEq(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`FAIL: ${message} (expected ${String(expected)}, got ${String(actual)})`);
  }
  console.log(`  ok — ${message}`);
}

const CAL = GOOGLE_CALENDAR_READONLY;
const DRIVE = GOOGLE_DRIVE_READONLY;

interface Harness {
  store: InMemoryConnectionStore;
  vault: InMemoryCredentialVault;
  connector: GoogleConnector;
  bridge: GoogleAuthorizationBridge;
  bridgeCalls: { authorize: number; getAccessToken: number; clearToken: string[]; revoke: number };
  fetchedUrls: string[];
  fetchedAuth: string[];
  responses: Response[];
}

function makeHarness(opts?: {
  responses?: Response[];
  fetchHandler?: (url: string, init: RequestInit) => Response;
}): Harness {
  const store = new InMemoryConnectionStore();
  const vault = new InMemoryCredentialVault();
  const bridgeCalls = { authorize: 0, getAccessToken: 0, clearToken: [] as string[], revoke: 0 };
  const bridge: GoogleAuthorizationBridge = {
    authorize: async ({ scopes }) => {
      bridgeCalls.authorize += 1;
      return { accessToken: 'access-auth', grantedScopes: scopes };
    },
    getAccessToken: async ({ scopes }) => {
      bridgeCalls.getAccessToken += 1;
      return { accessToken: `access-${bridgeCalls.getAccessToken}`, grantedScopes: scopes };
    },
    clearToken: async (token) => {
      bridgeCalls.clearToken.push(token);
    },
    revoke: async () => {
      bridgeCalls.revoke += 1;
    },
  };

  const fetchedUrls: string[] = [];
  const fetchedAuth: string[] = [];
  const responses = opts?.responses ?? [];

  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    fetchedUrls.push(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    fetchedAuth.push(headers.Authorization ?? '');
    if (opts?.fetchHandler) return opts.fetchHandler(url, init ?? {});
    return responses.shift() ?? new Response('{}', { status: 200 });
  };

  const fileSink: GoogleFileSink = {
    saveFile: async ({ fileName }) => ({ localUri: `file:///cache/${fileName}` }),
  };

  const connector = new GoogleConnector({
    store,
    vault,
    bridge,
    fileSink,
    fetchFn,
  });

  return { store, vault, connector, bridge, bridgeCalls, fetchedUrls, fetchedAuth, responses };
}

function connection(id: string, scopes: string[]): ConnectionRecord {
  const now = Date.now();
  return {
    id,
    connectorId: 'google',
    externalAccountId: id.slice('google:'.length),
    displayName: id,
    status: 'connected',
    scopes,
    capabilities: ['google.calendar.read', 'google.drive.read'],
    credentialReference: `google.oauth:${id}`,
    createdAt: now,
    updatedAt: now,
  };
}

async function executeTool(
  harness: Harness,
  tool: ConnectorTool<any, any>,
  input: Record<string, unknown>,
  record: ConnectionRecord,
): Promise<unknown> {
  await harness.store.save(record);
  const context: ToolExecutionContext = {
    taskId: 'task-1',
    agentId: 'agent-1',
    connection: record,
    idempotencyKey: 'key-1',
  };
  return tool.execute(input, context);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function main(): Promise<void> {
  console.log('connector status is partial (not mock):');
  {
    const harness = makeHarness();
    assertEq(harness.connector.implementationStatus, 'partial', 'GoogleConnector is partial');
  }

  console.log('production registry publishes only real tools:');
  {
    const store = new InMemoryConnectionStore();
    const record = connection('google:sub-1', [CAL, DRIVE]);
    await store.save(record);

    const connector = new GoogleConnector({ store });
    const registry = new ConnectorRegistry({ allowDevelopmentMocks: false });
    registry.register(connector);

    const active = await registry.listActiveTools();
    const names = active.map(({ tool }) => tool.name).sort();

    assertEq(names.length, 16, 'sixteen real Google tools are published');
    assert(names.includes('google.calendar.list_events'), 'calendar.list_events is published');
    assert(names.includes('google.calendar.get_event'), 'calendar.get_event is published');
    assert(names.includes('google.calendar.check_availability'), 'calendar.check_availability is published');
    assert(names.includes('google.drive.search'), 'drive.search is published');
    assert(names.includes('google.drive.get_metadata'), 'drive.get_metadata is published');
    assert(names.includes('google.drive.download'), 'drive.download is published');
    assert(names.includes('google.gmail.search'), 'gmail.search is published');
    assert(!names.some((n) => n.startsWith('google.people')), 'no People tools are published');
    assert(!names.some((n) => n.startsWith('google.tasks')), 'no Tasks tools are published');
    assert(!names.some((n) => n.startsWith('google.calendar.create')), 'no write Calendar tools');
    assert(!names.some((n) => n.startsWith('google.drive.upload')), 'no write Drive tools');

    for (const { tool } of active) {
      assertEq(tool.implementationStatus, 'real', `${tool.name} is real`);
      assert(
        Array.isArray(tool.requiredScopes) && tool.requiredScopes.length > 0,
        `${tool.name} declares requiredScopes`,
      );
    }
  }

  console.log('connect persists identity metadata only:');
  {
    const harness = makeHarness();
    harness.connector = new GoogleConnector({
      store: harness.store,
      vault: harness.vault,
      bridge: harness.bridge,
      authorize: async () => ({
        accessToken: 'access-auth',
        grantedScopes: [CAL, DRIVE],
        externalAccountId: 'sub-42',
        email: 'd@example.com',
        name: 'Daniyar',
      }),
    });

    const record = await harness.connector.connect();
    assertEq(record.id, 'google:sub-42', 'connection id follows the Google sub');
    assert(!('accessToken' in record), 'no access token on the ConnectionRecord');
    assert(!('refreshToken' in record), 'no refresh token on the ConnectionRecord');
    assertEq(record.scopes.length, 2, 'scopes are stored on the record');

    const cred = await harness.vault.get('google.oauth:google:sub-42');
    assert(cred?.kind === 'oauth', 'identity credential is stored');
    assertEq(cred?.accountName, 'd@example.com', 'account email is stored as accountName');
    assert(!('refreshToken' in (cred ?? {})), 'no refresh token is persisted');
  }

  console.log('calendar.list_events calls the real REST transport:');
  {
    const harness = makeHarness({
      responses: [
        jsonResponse({
          items: [
            { id: 'ev1', summary: 'Standup', start: { dateTime: '2026-08-07T10:00:00Z' }, end: { dateTime: '2026-08-07T11:00:00Z' }, status: 'confirmed' },
          ],
        }),
      ],
    });
    const [tool] = (await harness.connector.getTools(connection('google:sub-1', [CAL, DRIVE])))
      .filter((t) => t.name === 'google.calendar.list_events');

    const result = (await executeTool(harness, tool, {
      connectionId: 'google:sub-1',
      calendarId: 'primary',
      start: '2026-08-07T00:00:00Z',
      end: '2026-08-08T00:00:00Z',
      maxResults: 20,
    }, connection('google:sub-1', [CAL, DRIVE]))) as { items: Array<{ id: string }> };

    assertEq(result.items.length, 1, 'returns one event');
    assertEq(result.items[0].id, 'ev1', 'normalizes the event id');
    assert(
      harness.fetchedUrls[0].includes('/calendar/v3/calendars/primary/events'),
      'hits the Calendar events.list endpoint',
    );
    assertEq(harness.fetchedAuth[0], 'Bearer access-1', 'sends a Bearer token');
    assertEq(harness.bridgeCalls.getAccessToken, 1, 'mints one access token');
  }

  console.log('drive.search calls the real REST transport:');
  {
    const harness = makeHarness({
      responses: [jsonResponse({ files: [{ id: 'f1', name: 'report.pdf', mimeType: 'application/pdf' }] })],
    });
    const [tool] = (await harness.connector.getTools(connection('google:sub-1', [CAL, DRIVE])))
      .filter((t) => t.name === 'google.drive.search');

    const result = (await executeTool(harness, tool, {
      connectionId: 'google:sub-1',
      query: 'report',
      maxResults: 20,
    }, connection('google:sub-1', [CAL, DRIVE]))) as { files: Array<{ id: string }> };

    assertEq(result.files.length, 1, 'returns one file');
    const url = harness.fetchedUrls[0];
    assert(url.includes('/drive/v3/files'), 'hits the Drive files.list endpoint');
    assert(url.includes('q='), 'builds a Drive query');
    assert(url.includes('report'), 'includes the search text');
    assert(url.includes('trashed'), 'excludes trashed files');
  }

  console.log('401 clears the token and retries exactly once:');
  {
    const harness = makeHarness({
      fetchHandler: (url) => {
        const call = harness.fetchedUrls.length;
        if (call === 1) return jsonResponse({ error: { message: 'invalid token' } }, 401);
        return jsonResponse({ items: [] });
      },
    });
    const [tool] = (await harness.connector.getTools(connection('google:sub-1', [CAL, DRIVE])))
      .filter((t) => t.name === 'google.calendar.list_events');

    const result = (await executeTool(harness, tool, {
      connectionId: 'google:sub-1',
      calendarId: 'primary',
      start: '2026-08-07T00:00:00Z',
      end: '2026-08-08T00:00:00Z',
      maxResults: 20,
    }, connection('google:sub-1', [CAL, DRIVE]))) as { items: unknown[] };

    assertEq(result.items.length, 0, 'retry succeeds');
    assertEq(harness.bridgeCalls.getAccessToken, 2, 'mints a fresh token after 401');
    assertEq(harness.bridgeCalls.clearToken.length, 1, 'clears the invalid token once');
    assertEq(harness.fetchedUrls.length, 2, 'retries exactly once');
  }

  console.log('403 maps to a permission error:');
  {
    const harness = makeHarness({
      fetchHandler: () => jsonResponse({ error: { message: 'insufficient scopes' } }, 403),
    });
    const [tool] = (await harness.connector.getTools(connection('google:sub-1', [CAL, DRIVE])))
      .filter((t) => t.name === 'google.calendar.get_event');

    let code = '';
    try {
      await executeTool(harness, tool, { connectionId: 'google:sub-1', calendarId: 'primary', eventId: 'ev1' }, connection('google:sub-1', [CAL, DRIVE]));
    } catch (error) {
      code = (error as { code?: string })?.code ?? '';
    }
    assertEq(code, 'PERMISSION_REQUIRED', '403 surfaces as PERMISSION_REQUIRED');
  }

  console.log('drive.download exports Google Docs and alt=media for blobs:');
  {
    const meta = jsonResponse({
      id: 'doc1', name: 'Notes', mimeType: 'application/vnd.google-apps.document', capabilities: { canDownload: true },
    });
    const harness = makeHarness({
      responses: [meta, new Response(new Uint8Array([1, 2, 3]), { status: 200 })],
    });
    const [tool] = (await harness.connector.getTools(connection('google:sub-1', [CAL, DRIVE])))
      .filter((t) => t.name === 'google.drive.download');

    const result = (await executeTool(harness, tool, { connectionId: 'google:sub-1', fileId: 'doc1' }, connection('google:sub-1', [CAL, DRIVE]))) as { localUri: string };

    assert(result.localUri.startsWith('file://'), 'returns a local URI');
    assert(
      harness.fetchedUrls.some((url) => url.includes('/export') && url.includes('mimeType=application%2Fpdf')),
      'Google Docs uses files.export with a PDF export mime type',
    );
  }
  {
    const meta = jsonResponse({ id: 'f1', name: 'report.pdf', mimeType: 'application/pdf', capabilities: { canDownload: true } });
    const harness = makeHarness({
      responses: [meta, new Response(new Uint8Array([1, 2, 3]), { status: 200 })],
    });
    const [tool] = (await harness.connector.getTools(connection('google:sub-1', [CAL, DRIVE])))
      .filter((t) => t.name === 'google.drive.download');

    await executeTool(harness, tool, { connectionId: 'google:sub-1', fileId: 'f1' }, connection('google:sub-1', [CAL, DRIVE]));
    assert(
      harness.fetchedUrls.some((url) => url.includes('alt=media')),
      'normal Drive file uses alt=media',
    );
  }

  console.log('disconnect removes only the selected account:');
  {
    const store = new InMemoryConnectionStore();
    const vault = new InMemoryCredentialVault();
    const bridgeCalls = { revoke: 0 };
    const bridge: GoogleAuthorizationBridge = {
      authorize: async ({ scopes }) => ({ accessToken: 'a', grantedScopes: scopes }),
      getAccessToken: async () => ({ accessToken: 'a', grantedScopes: [] }),
      clearToken: async () => {},
      revoke: async () => { bridgeCalls.revoke += 1; },
    };

    // Two accounts via two connectors sharing a store/vault.
    const connectorA = new GoogleConnector({
      store, vault, bridge,
      authorize: async () => ({ accessToken: 'a', grantedScopes: [CAL, DRIVE], externalAccountId: 'A', email: 'a@example.com' }),
    });
    const connectorB = new GoogleConnector({
      store, vault, bridge,
      authorize: async () => ({ accessToken: 'b', grantedScopes: [CAL, DRIVE], externalAccountId: 'B', email: 'b@example.com' }),
    });

    const ra = await connectorA.connect();
    const rb = await connectorB.connect();

    await connectorA.disconnect(ra.id);

    assertEq(await store.get(ra.id), null, 'account A record is removed');
    assert(await store.get(rb.id) !== null, 'account B record is untouched');
    assertEq(await vault.get('google.oauth:google:A'), null, 'account A credential removed');
    assert(await vault.get('google.oauth:google:B') !== null, 'account B credential untouched');
    assertEq(bridgeCalls.revoke, 1, 'revoke is called once');
  }

  console.log('verify:google — all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
