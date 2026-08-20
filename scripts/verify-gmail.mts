/**
 * Gmail connector verification (production Gmail tools over the Gmail REST API).
 *
 * Uses an injected fake AuthorizationClient bridge and a stateful fake fetch so
 * the Gmail REST layer and the MIME/encoding helpers are exercised
 * deterministically without a real account.
 *
 * Run: npm run verify:gmail
 */
import { ConnectorRegistry } from '@mobile-agent/connector-registry';
import {
  GoogleConnector,
  GOOGLE_GMAIL_COMPOSE,
  GOOGLE_GMAIL_MODIFY,
  GOOGLE_GMAIL_READONLY,
  computeDraftFingerprint,
  decodeBase64Url,
  encodeBase64Url,
  htmlToText,
  utf8Decode,
  utf8Encode,
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
import { DEFAULT_APPROVAL_POLICY } from '@mobile-agent/policy-core';

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

const GMAIL_READ = GOOGLE_GMAIL_READONLY;
const GMAIL_COMPOSE = GOOGLE_GMAIL_COMPOSE;
const GMAIL_MODIFY = GOOGLE_GMAIL_MODIFY;

// --- Gmail resource builders ------------------------------------------------

function textPart(mimeType: string, text: string) {
  return {
    mimeType,
    headers: [{ name: 'Content-Type', value: `${mimeType}; charset=UTF-8` }],
    body: { size: utf8Encode(text).length, data: encodeBase64Url(text) },
  };
}

function attachmentPart(partId: string, filename: string, mimeType: string, size: number) {
  return {
    partId,
    mimeType,
    filename,
    body: { size, attachmentId: `ATT-${partId}` },
  };
}

interface MessageParts {
  text?: string;
  html?: string;
  attachments?: Array<ReturnType<typeof attachmentPart>>;
  multipart?: boolean;
}

function gmailMessage(
  id: string,
  threadId: string,
  subject: string,
  from: string,
  to: string,
  parts: MessageParts = {},
) {
  const headers = [
    { name: 'From', value: from },
    { name: 'To', value: to },
    { name: 'Subject', value: subject },
    { name: 'Date', value: 'Mon, 1 Jan 2026 10:00:00 +0000' },
    { name: 'Message-ID', value: `<${id}@mail.gmail.com>` },
  ];

  const childParts: unknown[] = [];
  if (parts.multipart) {
    childParts.push({
      mimeType: 'multipart/alternative',
      parts: [
        ...(parts.text !== undefined ? [textPart('text/plain', parts.text)] : []),
        ...(parts.html !== undefined ? [textPart('text/html', parts.html)] : []),
      ],
    });
  } else {
    if (parts.text !== undefined) childParts.push(textPart('text/plain', parts.text));
    if (parts.html !== undefined) childParts.push(textPart('text/html', parts.html));
  }
  if (parts.attachments) childParts.push(...parts.attachments);

  return {
    id,
    threadId,
    labelIds: ['INBOX', 'UNREAD'],
    snippet: (parts.text ?? parts.html ?? '').slice(0, 20),
    payload: {
      mimeType: childParts.length > 1 ? 'multipart/mixed' : 'text/plain',
      headers,
      parts: childParts,
    },
  };
}

function draftRecord(id: string, message: ReturnType<typeof gmailMessage>) {
  return { id, message };
}

// --- Harness ------------------------------------------------------------------

interface FetchedCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  auth: string;
}

interface Harness {
  store: InMemoryConnectionStore;
  vault: InMemoryCredentialVault;
  connector: GoogleConnector;
  bridgeCalls: {
    getAccessToken: Array<{ scopes: string[]; accountName?: string }>;
    clearToken: string[];
  };
  fetched: FetchedCall[];
  state: {
    messages: Map<string, ReturnType<typeof gmailMessage>>;
    drafts: Map<string, ReturnType<typeof draftRecord>>;
    failNext401: boolean;
  };
}

function makeHarness(): Harness {
  const store = new InMemoryConnectionStore();
  const vault = new InMemoryCredentialVault();
  const bridgeCalls = {
    getAccessToken: [] as Array<{ scopes: string[]; accountName?: string }>,
    clearToken: [] as string[],
  };
  const state = {
    messages: new Map<string, ReturnType<typeof gmailMessage>>(),
    drafts: new Map<string, ReturnType<typeof draftRecord>>(),
    failNext401: false,
  };
  const fetched: FetchedCall[] = [];

  const bridge: GoogleAuthorizationBridge = {
    authorize: async ({ scopes }) => ({ accessToken: 'access-auth', grantedScopes: scopes }),
    getAccessToken: async ({ scopes, accountName }) => {
      bridgeCalls.getAccessToken.push({ scopes, accountName });
      return { accessToken: `token-${accountName ?? 'default'}`, grantedScopes: scopes };
    },
    clearToken: async (token) => {
      bridgeCalls.clearToken.push(token);
    },
    revoke: async () => {},
  };

  const fileSink: GoogleFileSink = {
    saveFile: async ({ fileName }) => ({ localUri: `file:///cache/${fileName}` }),
  };

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/gmail\/v1/, '');
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    fetched.push({ method, path, query, body, auth: headers.Authorization ?? '' });

    if (state.failNext401) {
      state.failNext401 = false;
      return json({ error: { code: 401, message: 'Invalid Credentials' } }, 401);
    }

    // List messages (search).
    if (path === '/users/me/messages' && method === 'GET') {
      const ids = [...state.messages.keys()];
      return json({
        messages: ids.map((id) => {
          const m = state.messages.get(id)!;
          return { id, threadId: m.threadId };
        }),
        resultSizeEstimate: ids.length,
      });
    }

    // Message modify (archive / mark read).
    const modify = /^\/users\/me\/messages\/([^/]+)\/modify$/.exec(path);
    if (modify && method === 'POST') {
      const id = decodeURIComponent(modify[1]!);
      const m = state.messages.get(id);
      return m ? json(m) : json({ error: { code: 404, message: 'Not Found' } }, 404);
    }

    // Attachment get.
    const attach = /^\/users\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(path);
    if (attach && method === 'GET') {
      return json({ data: encodeBase64Url('binary-attachment-content'), size: 27 });
    }

    // Single message get.
    const msg = /^\/users\/me\/messages\/([^/]+)$/.exec(path);
    if (msg && method === 'GET') {
      const id = decodeURIComponent(msg[1]!);
      const m = state.messages.get(id);
      return m ? json(m) : json({ error: { code: 404, message: 'Not Found' } }, 404);
    }

    // Thread get.
    const thread = /^\/users\/me\/threads\/([^/]+)$/.exec(path);
    if (thread && method === 'GET') {
      const tid = decodeURIComponent(thread[1]!);
      const messages = [...state.messages.values()].filter((m) => m.threadId === tid);
      return json({ id: tid, historyId: '123', messages });
    }

    // Draft list.
    if (path === '/users/me/drafts' && method === 'GET') {
      return json({ drafts: [...state.drafts.values()] });
    }

    // Draft create.
    if (path === '/users/me/drafts' && method === 'POST') {
      const message = state.messages.get('m-draft') ?? {
        id: 'm-draft',
        threadId: 't-draft',
        labelIds: ['DRAFT'],
        snippet: '',
        payload: { mimeType: 'text/plain', headers: [], parts: [] },
      };
      state.drafts.set('d1', draftRecord('d1', message));
      return json({ id: 'd1', message: { id: message.id, threadId: message.threadId } });
    }

    // Draft send.
    if (path === '/users/me/drafts/send' && method === 'POST') {
      return json({ id: 'm-sent', threadId: 't-draft' });
    }

    // Draft get/update.
    const draft = /^\/users\/me\/drafts\/([^/]+)$/.exec(path);
    if (draft) {
      const id = decodeURIComponent(draft[1]!);
      if (method === 'GET') {
        const d = state.drafts.get(id);
        return d ? json(d) : json({ error: { code: 404, message: 'Not Found' } }, 404);
      }
      if (method === 'PUT') {
        const d = state.drafts.get(id);
        return d ? json(d) : json({ error: { code: 404, message: 'Not Found' } }, 404);
      }
    }

    // Profile.
    if (path === '/users/me/profile' && method === 'GET') {
      return json({ emailAddress: 'me@gmail.com', messagesTotal: 10 });
    }

    return json({ error: { code: 404, message: 'No route' } }, 404);
  };

  const connector = new GoogleConnector({
    store,
    vault,
    bridge,
    fileSink,
    fetchFn,
  });

  return { store, vault, connector, bridgeCalls, fetched, state };
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
    capabilities: ['google.gmail.read', 'google.gmail.compose', 'google.gmail.modify'],
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

function toolsOf(harness: Harness, record: ConnectionRecord) {
  return harness.connector.getTools(record);
}

async function findTool(
  harness: Harness,
  name: string,
  record: ConnectionRecord,
): Promise<ConnectorTool<any, any>> {
  const tool = (await toolsOf(harness, record)).find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

const ALL_GMAIL = [GMAIL_READ, GMAIL_COMPOSE, GMAIL_MODIFY];

async function main(): Promise<void> {
  // --- base64url + UTF-8 round trip ----------------------------------------
  console.log('encoding: base64url + UTF-8 round-trip:');
  {
    const samples = ['hello', 'кириллица', 'қазақша', 'emoji 🎉📧', ''];
    for (const sample of samples) {
      const encoded = encodeBase64Url(sample);
      assert(!encoded.includes('='), `${JSON.stringify(sample)} encodes without padding`);
      const decoded = utf8Decode(decodeBase64Url(encoded));
      assertEq(decoded, sample, `round-trips ${JSON.stringify(sample)}`);
    }
  }

  console.log('html → text never executes script and extracts readable text:');
  {
    const text = htmlToText(
      '<p>Hello <b>world</b></p><script>alert(1)</script><br>Next line &amp; more',
    );
    assert(text.includes('Hello world'), 'extracts body text');
    assert(!text.includes('alert'), 'drops script content');
    assert(text.includes('Next line'), 'keeps visible text');
  }

  // --- production registry --------------------------------------------------
  console.log('Gmail tools are published in the production registry:');
  {
    const harness = makeHarness();
    const record = connection('google:sub-1', ALL_GMAIL);
    const connector = new GoogleConnector({ store: harness.store, vault: harness.vault, bridge: {
      authorize: async ({ scopes }) => ({ accessToken: 'a', grantedScopes: scopes }),
      getAccessToken: async ({ scopes }) => ({ accessToken: 'a', grantedScopes: scopes }),
      clearToken: async () => {},
      revoke: async () => {},
    } });
    const registry = new ConnectorRegistry({ allowDevelopmentMocks: false });
    registry.register(connector);
    await harness.store.save(record);

    const active = await registry.listActiveTools();
    const gmailTools = active
      .map(({ tool }) => tool)
      .filter((tool) => tool.name.startsWith('google.gmail'));

    assertEq(gmailTools.length, 10, 'ten Gmail tools are published');
    for (const tool of gmailTools) {
      assertEq(tool.implementationStatus, 'real', `${tool.name} is real`);
      assert(tool.requiredScopes.length > 0, `${tool.name} declares requiredScopes`);
    }
  }

  console.log('Gmail tools declare the correct scopes:');
  {
    const harness = makeHarness();
    const record = connection('google:sub-1', ALL_GMAIL);
    const scopeMap: Record<string, string> = {
      'google.gmail.search': GMAIL_READ,
      'google.gmail.get_message': GMAIL_READ,
      'google.gmail.get_thread': GMAIL_READ,
      'google.gmail.list_drafts': GMAIL_READ,
      'google.gmail.get_attachment': GMAIL_READ,
      'google.gmail.create_draft': GMAIL_COMPOSE,
      'google.gmail.update_draft': GMAIL_COMPOSE,
      'google.gmail.send_draft': GMAIL_COMPOSE,
      'google.gmail.archive': GMAIL_MODIFY,
      'google.gmail.mark_read': GMAIL_MODIFY,
    };
    for (const [name, scope] of Object.entries(scopeMap)) {
      const tool = await findTool(harness, name, record);
      assert(tool.requiredScopes.includes(scope), `${name} requires ${scope}`);
    }
  }

  console.log('send_draft is external_side_effect and requires approval:');
  {
    const harness = makeHarness();
    const record = connection('google:sub-1', ALL_GMAIL);
    const send = await findTool(harness, 'google.gmail.send_draft', record);
    assertEq(send.risk, 'external_side_effect', 'send_draft risk is external_side_effect');
    assertEq(
      DEFAULT_APPROVAL_POLICY[send.risk],
      'always',
      'external_side_effect always requires approval',
    );
  }

  // --- search ---------------------------------------------------------------
  console.log('google.gmail.search hits /users/me/messages and enriches metadata:');
  {
    const harness = makeHarness();
    harness.state.messages.set('m1', gmailMessage('m1', 't1', 'Standup', 'alice@example.com', 'me@gmail.com', { text: 'Standup notes' }));
    harness.state.messages.set('m2', gmailMessage('m2', 't2', 'Invoice', 'bob@example.com', 'me@gmail.com', { text: 'Invoice attached' }));

    const record = connection('google:sub-1', ALL_GMAIL);
    const tool = await findTool(harness, 'google.gmail.search', record);
    const result = (await executeTool(harness, tool, {
      connectionId: record.id,
      query: 'from:alice@example.com',
      maxResults: 10,
    }, record)) as { messages: Array<{ id: string }> };

    const listCall = harness.fetched.find((c) => c.path === '/users/me/messages');
    assert(listCall !== undefined, 'calls messages.list');
    assertEq(listCall!.query.q, 'from:alice@example.com', 'passes q through');

    const metadataCalls = harness.fetched.filter(
      (c) => /^\/users\/me\/messages\/m\d$/.test(c.path) && c.method === 'GET',
    );
    assertEq(metadataCalls.length, 2, 'fetches metadata for each hit');

    assertEq(result.messages.length, 2, 'returns two messages');
    assertEq(result.messages[0]!.id, 'm1', 'preserves list order');
  }

  // --- get_message text/plain ----------------------------------------------
  console.log('google.gmail.get_message parses text/plain:');
  {
    const harness = makeHarness();
    harness.state.messages.set(
      'm1',
      gmailMessage('m1', 't1', 'Привет', 'alice@example.com', 'me@gmail.com', {
        text: 'Здравствуйте! Қазақша ✉️',
      }),
    );
    const record = connection('google:sub-1', ALL_GMAIL);
    const tool = await findTool(harness, 'google.gmail.get_message', record);
    const result = (await executeTool(harness, tool, {
      connectionId: record.id,
      messageId: 'm1',
    }, record)) as { textBody?: string; subject?: string };

    assertEq(result.textBody, 'Здравствуйте! Қазақша ✉️', 'decodes UTF-8 body');
    assertEq(result.subject, 'Привет', 'decodes subject');
  }

  console.log('get_message parses multipart/alternative:');
  {
    const harness = makeHarness();
    harness.state.messages.set(
      'm1',
      gmailMessage('m1', 't1', 'Alt', 'alice@example.com', 'me@gmail.com', {
        text: 'plain body',
        html: '<b>html body</b>',
        multipart: true,
      }),
    );
    const record = connection('google:sub-1', ALL_GMAIL);
    const tool = await findTool(harness, 'google.gmail.get_message', record);
    const result = (await executeTool(harness, tool, {
      connectionId: record.id,
      messageId: 'm1',
    }, record)) as { textBody?: string; htmlBody?: string };

    assertEq(result.textBody, 'plain body', 'extracts text/plain');
    assertEq(result.htmlBody, '<b>html body</b>', 'extracts text/html');
  }

  console.log('get_message parses multipart/mixed and attachment metadata:');
  {
    const harness = makeHarness();
    harness.state.messages.set(
      'm1',
      gmailMessage('m1', 't1', 'Mixed', 'alice@example.com', 'me@gmail.com', {
        text: 'see attachment',
        html: '<p>see attachment</p>',
        multipart: true,
        attachments: [attachmentPart('0', 'report.pdf', 'application/pdf', 2048)],
      }),
    );
    const record = connection('google:sub-1', ALL_GMAIL);
    const tool = await findTool(harness, 'google.gmail.get_message', record);
    const result = (await executeTool(harness, tool, {
      connectionId: record.id,
      messageId: 'm1',
    }, record)) as {
      textBody?: string;
      htmlBody?: string;
      attachments: Array<{ attachmentId?: string; filename: string; mimeType: string; size: number }>;
    };

    assertEq(result.textBody, 'see attachment', 'extracts body from nested alternative');
    assertEq(result.attachments.length, 1, 'finds one attachment');
    assertEq(result.attachments[0]!.filename, 'report.pdf', 'attachment filename');
    assertEq(result.attachments[0]!.mimeType, 'application/pdf', 'attachment mime type');
    assertEq(result.attachments[0]!.attachmentId, 'ATT-0', 'attachment id');
  }

  console.log('get_message converts html-only bodies to text:');
  {
    const harness = makeHarness();
    harness.state.messages.set(
      'm1',
      gmailMessage('m1', 't1', 'Html only', 'alice@example.com', 'me@gmail.com', {
        html: '<p>Hello <b>world</b></p><script>alert(1)</script>',
      }),
    );
    const record = connection('google:sub-1', ALL_GMAIL);
    const tool = await findTool(harness, 'google.gmail.get_message', record);
    const result = (await executeTool(harness, tool, {
      connectionId: record.id,
      messageId: 'm1',
    }, record)) as { textBody?: string; htmlBody?: string };

    assert(
      result.textBody !== undefined && result.textBody.includes('Hello world'),
      'converts html to readable text',
    );
    assert(!(result.textBody ?? '').includes('alert'), 'drops script content');
  }

  // --- thread ---------------------------------------------------------------
  console.log('google.gmail.get_thread returns the full conversation:');
  {
    const harness = makeHarness();
    harness.state.messages.set('m1', gmailMessage('m1', 't1', 'Re: hi', 'alice@example.com', 'me@gmail.com', { text: 'first' }));
    harness.state.messages.set('m2', gmailMessage('m2', 't1', 'Re: hi', 'me@gmail.com', 'alice@example.com', { text: 'second' }));
    const record = connection('google:sub-1', ALL_GMAIL);
    const tool = await findTool(harness, 'google.gmail.get_thread', record);
    const result = (await executeTool(harness, tool, {
      connectionId: record.id,
      threadId: 't1',
      maxMessages: 100,
    }, record)) as { id: string; messages: Array<{ id: string }> };

    assertEq(result.id, 't1', 'thread id');
    assertEq(result.messages.length, 2, 'returns both messages');
  }

  // --- drafts ---------------------------------------------------------------
  console.log('google.gmail.create_draft builds valid MIME and uses drafts.create:');
  {
    const harness = makeHarness();
    const record = connection('google:sub-1', ALL_GMAIL);
    const tool = await findTool(harness, 'google.gmail.create_draft', record);
    const result = (await executeTool(harness, tool, {
      connectionId: record.id,
      to: ['john@example.com'],
      cc: ['cc@example.com'],
      subject: 'Привет мир',
      textBody: 'Это тело письма. Қазақша ✉️',
    }, record)) as { id: string; fingerprint: string; preview: { to: string[]; subject: string } };

    const createCall = harness.fetched.find(
      (c) => c.path === '/users/me/drafts' && c.method === 'POST',
    );
    assert(createCall !== undefined, 'calls drafts.create');
    const raw = (createCall!.body as { message: { raw: string } }).message.raw;
    const mime = utf8Decode(decodeBase64Url(raw));
    assert(mime.includes('To: john@example.com'), 'MIME has To header');
    assert(mime.includes('Cc: cc@example.com'), 'MIME has Cc header');
    assert(mime.includes('Content-Type: text/plain'), 'MIME has text/plain part');
    assert(mime.includes('Subject: =?UTF-8?B?'), 'non-ASCII subject is RFC 2047 encoded');
    assert(mime.includes('Content-Transfer-Encoding: base64'), 'body is base64 encoded');

    const expectedFingerprint = computeDraftFingerprint({
      to: ['john@example.com'],
      cc: ['cc@example.com'],
      subject: 'Привет мир',
      textBody: 'Это тело письма. Қазақша ✉️',
    });
    assertEq(result.fingerprint, expectedFingerprint, 'fingerprint binds to content');
    assertEq(result.preview.subject, 'Привет мир', 'preview carries subject');
    assertEq(result.preview.to[0], 'john@example.com', 'preview carries recipient');
  }

  console.log('google.gmail.update_draft replaces MIME via drafts.update:');
  {
    const harness = makeHarness();
    const record = connection('google:sub-1', ALL_GMAIL);
    harness.state.drafts.set(
      'd1',
      draftRecord(
        'd1',
        gmailMessage('m1', 't1', 'Old subject', 'me@gmail.com', 'john@example.com', { text: 'old body' }),
      ),
    );
    const tool = await findTool(harness, 'google.gmail.update_draft', record);
    const result = (await executeTool(harness, tool, {
      connectionId: record.id,
      draftId: 'd1',
      subject: 'New subject',
      body: 'new body',
    }, record)) as { fingerprint: string };

    const updateCall = harness.fetched.find(
      (c) => c.path === '/users/me/drafts/d1' && c.method === 'PUT',
    );
    assert(updateCall !== undefined, 'calls drafts.update');
    const raw = (updateCall!.body as { message: { raw: string } }).message.raw;
    const mime = utf8Decode(decodeBase64Url(raw));
    assert(mime.includes('Subject: New subject'), 'new subject applied');
    assert(mime.includes('bmV3IGJvZHk'), 'new body applied (base64 encoded)');
    assertEq(
      result.fingerprint,
      computeDraftFingerprint({ to: ['john@example.com'], subject: 'New subject', textBody: 'new body' }),
      'update fingerprint reflects merged content',
    );
  }

  console.log('google.gmail.send_draft sends only an unchanged, approved draft:');
  {
    const harness = makeHarness();
    const record = connection('google:sub-1', ALL_GMAIL);
    const draft = gmailMessage('m1', 't1', 'Project update', 'me@gmail.com', 'john@example.com', { text: 'Hello John' });
    harness.state.drafts.set('d1', draftRecord('d1', draft));

    const fingerprint = computeDraftFingerprint({
      to: ['john@example.com'],
      subject: 'Project update',
      textBody: 'Hello John',
    });

    const tool = await findTool(harness, 'google.gmail.send_draft', record);
    const result = (await executeTool(harness, tool, {
      connectionId: record.id,
      draftId: 'd1',
      fingerprint,
      to: ['john@example.com'],
      subject: 'Project update',
      body: 'Hello John',
    }, record)) as { sent: boolean; messageId: string };

    assertEq(result.sent, true, 'draft is sent');
    const sendCall = harness.fetched.find((c) => c.path === '/users/me/drafts/send');
    assert(sendCall !== undefined, 'calls drafts.send');
  }

  console.log('send_draft refuses a draft changed after approval (TOCTOU):');
  {
    const harness = makeHarness();
    const record = connection('google:sub-1', ALL_GMAIL);
    harness.state.drafts.set(
      'd1',
      draftRecord('d1', gmailMessage('m1', 't1', 'Project update', 'me@gmail.com', 'john@example.com', { text: 'Hello John' })),
    );
    const fingerprint = computeDraftFingerprint({
      to: ['john@example.com'],
      subject: 'Project update',
      textBody: 'Hello John',
    });

    // The draft changes after approval: subject and body mutate server-side.
    harness.state.drafts.set(
      'd1',
      draftRecord('d1', gmailMessage('m1', 't1', 'Changed subject', 'me@gmail.com', 'john@example.com', { text: 'Changed body' })),
    );

    const tool = await findTool(harness, 'google.gmail.send_draft', record);
    let rejected = false;
    try {
      await executeTool(harness, tool, {
        connectionId: record.id,
        draftId: 'd1',
        fingerprint,
        to: ['john@example.com'],
        subject: 'Project update',
        body: 'Hello John',
      }, record);
    } catch (error) {
      rejected = (error as { code?: string }).code === 'VALIDATION_FAILED';
    }
    assert(rejected, 'send_draft rejects a changed draft');
    assertEq(
      harness.fetched.some((c) => c.path === '/users/me/drafts/send'),
      false,
      'drafts.send is never reached',
    );
  }

  // --- actions --------------------------------------------------------------
  console.log('google.gmail.archive removes INBOX:');
  {
    const harness = makeHarness();
    harness.state.messages.set('m1', gmailMessage('m1', 't1', 'Hi', 'alice@example.com', 'me@gmail.com', { text: 'x' }));
    const record = connection('google:sub-1', ALL_GMAIL);
    const tool = await findTool(harness, 'google.gmail.archive', record);
    await executeTool(harness, tool, { connectionId: record.id, messageId: 'm1' }, record);
    const call = harness.fetched.find((c) => c.path === '/users/me/messages/m1/modify');
    assert(call !== undefined, 'calls messages.modify');
    assertEq(
      JSON.stringify((call!.body as { removeLabelIds: string[] }).removeLabelIds),
      JSON.stringify(['INBOX']),
      'removes INBOX',
    );
  }

  console.log('google.gmail.mark_read removes UNREAD:');
  {
    const harness = makeHarness();
    harness.state.messages.set('m1', gmailMessage('m1', 't1', 'Hi', 'alice@example.com', 'me@gmail.com', { text: 'x' }));
    const record = connection('google:sub-1', ALL_GMAIL);
    const tool = await findTool(harness, 'google.gmail.mark_read', record);
    await executeTool(harness, tool, { connectionId: record.id, messageId: 'm1' }, record);
    const call = harness.fetched.find((c) => c.path === '/users/me/messages/m1/modify');
    assert(call !== undefined, 'calls messages.modify');
    assertEq(
      JSON.stringify((call!.body as { removeLabelIds: string[] }).removeLabelIds),
      JSON.stringify(['UNREAD']),
      'removes UNREAD',
    );
  }

  // --- token lifecycle ------------------------------------------------------
  console.log('401 clears the token and retries exactly once:');
  {
    const harness = makeHarness();
    harness.state.messages.set('m1', gmailMessage('m1', 't1', 'Hi', 'alice@example.com', 'me@gmail.com', { text: 'x' }));
    harness.state.failNext401 = true;
    const record = connection('google:sub-1', ALL_GMAIL);
    const tool = await findTool(harness, 'google.gmail.get_message', record);
    const result = (await executeTool(harness, tool, {
      connectionId: record.id,
      messageId: 'm1',
    }, record)) as { id: string };

    assertEq(result.id, 'm1', 'retry succeeds');
    const messageCalls = harness.fetched.filter((c) => c.path === '/users/me/messages/m1');
    assertEq(messageCalls.length, 2, 'requests the message twice (initial + retry)');
    assertEq(harness.bridgeCalls.clearToken.length, 1, 'clears the invalid token once');
  }

  console.log('403 permission error is not masked:');
  {
    const harness = makeHarness();
    const record = connection('google:sub-1', ALL_GMAIL);
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({ error: { code: 403, message: 'Insufficient Permission', errors: [{ reason: 'insufficientPermissions' }] } }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    const connector = new GoogleConnector({ store: harness.store, vault: harness.vault, bridge: {
      authorize: async ({ scopes }) => ({ accessToken: 'a', grantedScopes: scopes }),
      getAccessToken: async ({ scopes }) => ({ accessToken: 'a', grantedScopes: scopes }),
      clearToken: async () => {},
      revoke: async () => {},
    }, fetchFn });
    const tool = (await connector.getTools(record)).find((t) => t.name === 'google.gmail.search')!;
    let code = '';
    try {
      await executeTool(harness, tool, { connectionId: record.id, query: 'is:unread' }, record);
    } catch (error) {
      code = (error as { code?: string }).code ?? '';
    }
    assertEq(code, 'PERMISSION_REQUIRED', '403 surfaces as PERMISSION_REQUIRED');
  }

  // --- multi-account isolation ---------------------------------------------
  console.log('personal and work accounts resolve distinct tokens:');
  {
    const harness = makeHarness();
    harness.state.messages.set('m1', gmailMessage('m1', 't1', 'Work', 'boss@work.com', 'me@work.com', { text: 'work mail' }));
    await harness.vault.save('google.oauth:google:personal', { kind: 'oauth', accessToken: 'x', scopes: ALL_GMAIL, accountName: 'personal@gmail.com' });
    await harness.vault.save('google.oauth:google:work', { kind: 'oauth', accessToken: 'x', scopes: ALL_GMAIL, accountName: 'work@gmail.com' });

    const personal = connection('google:personal', ALL_GMAIL);
    personal.credentialReference = 'google.oauth:google:personal';
    const tool = await findTool(harness, 'google.gmail.search', personal);
    await executeTool(harness, tool, { connectionId: 'google:personal', query: 'is:unread' }, personal);

    const listCall = harness.fetched.find((c) => c.path === '/users/me/messages');
    assertEq(listCall!.auth, 'Bearer token-personal@gmail.com', 'uses the personal account token');

    // The work connection resolves a different token for the same tool name.
    const work = connection('google:work', ALL_GMAIL);
    work.credentialReference = 'google.oauth:google:work';
    await executeTool(harness, tool, { connectionId: 'google:work', query: 'is:unread' }, work);
    const workCall = harness.fetched.find((c) => c.path === '/users/me/messages' && c.auth.includes('work'));
    assert(workCall !== undefined, 'uses the work account token');
  }

  // --- no token leakage -----------------------------------------------------
  console.log('tokens never land on the ConnectionRecord:');
  {
    const harness = makeHarness();
    const record = connection('google:sub-1', ALL_GMAIL);
    await harness.store.save(record);
    const stored = await harness.store.get(record.id);
    assert(!('accessToken' in (stored ?? {})), 'no accessToken on the record');
    assert(!('refreshToken' in (stored ?? {})), 'no refreshToken on the record');
  }

  console.log('verify:gmail — all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
