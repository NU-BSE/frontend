/**
 * Connection truthfulness tests:
 *
 * - fresh install exposes no external account tools;
 * - a UI tap cannot create a fake connection;
 * - only a successful auth flow creates `status: connected`;
 * - disconnect removes the record and revokes stored credentials;
 * - MCP tools disappear after disconnect;
 * - an expired connection exposes no tools;
 * - two accounts coexist and are selected by connectionId;
 * - persisted connections survive an app restart;
 * - the production registry refuses mock connectors.
 *
 * Run: npm run verify:connections
 */
import * as z from 'zod/v4';
import { InMemoryApprovalService } from '@mobile-agent/approval-core';
import {
  InMemoryConnectionStore,
  PersistentConnectionStore,
  type ConnectionRecord,
  type Connector,
  type ConnectorTool,
  type KeyValueBackend,
} from '@mobile-agent/connector-core';
import { InMemoryCredentialVault } from '@mobile-agent/credential-vault';
import { DefaultPolicyEngine } from '@mobile-agent/policy-core';
import { createLocalMcpRuntime } from '@mobile-agent/mcp-client';
import { ConnectorRegistry } from '@mobile-agent/connector-registry';
import {
  MockTdlibAdapter,
  TelegramUserConnector,
} from '@mobile-agent/connector-telegram';

import { createConnectorRegistry } from '../src/mcp/create-connector-registry.js';
import {
  closeLocalMcpRuntime,
  configureAppDependencies,
  getConnectionStore,
  getCredentialVault,
  getLocalMcpRuntime,
} from '../src/mcp/runtime-singleton.js';
import {
  connectConnector,
  disconnectConnection,
} from '../src/connections/connectionService.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok — ${message}`);
}

async function expectError(
  call: () => Promise<unknown>,
  message: string,
): Promise<string> {
  try {
    await call();
  } catch (error) {
    console.log(`  ok — ${message}`);
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`FAIL: expected an error — ${message}`);
}

function record(
  partial: Partial<ConnectionRecord> & Pick<ConnectionRecord, 'id' | 'connectorId'>,
): ConnectionRecord {
  const now = Date.now();
  return {
    displayName: partial.id,
    status: 'connected',
    scopes: [],
    capabilities: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

/** Test double proving per-connection dispatch for one shared tool name. */
class EchoConnector implements Connector {
  readonly id = 'google' as const;
  readonly displayName = 'Echo';
  readonly implementationStatus = 'mock' as const;

  constructor(private readonly store: InMemoryConnectionStore) {}

  async listConnections() {
    return this.store.listByConnector(this.id);
  }

  async getConnection(connectionId: string) {
    const connection = await this.store.get(connectionId);
    return connection && connection.connectorId === this.id ? connection : null;
  }

  async getTools(): Promise<ConnectorTool<any, any>[]> {
    return [
      {
        name: 'echo.connection',
        title: 'Echo connection',
        description: 'Returns the connection the call was dispatched to.',
        inputSchema: z.object({ connectionId: z.string().min(1) }),
        risk: 'read',
        capabilities: [],
        requiredScopes: [],
        implementationStatus: 'development_mock',
        execute: async (_input, context) => ({
          connectionId: context.connection.id,
          displayName: context.connection.displayName,
        }),
      },
    ];
  }

  async disconnect(connectionId: string) {
    await this.store.remove(connectionId);
  }
}

async function main(): Promise<void> {
  // Shared in-memory app dependencies so the singleton behaves like the app
  // (one store + vault across runtime restarts) without AsyncStorage.
  const appStore = new InMemoryConnectionStore();
  const appVault = new InMemoryCredentialVault();
  configureAppDependencies({ connectionStore: appStore, credentialVault: appVault });

  console.log('fresh install (production):');

  await getLocalMcpRuntime({ mode: 'production' });

  {
    const runtime = await getLocalMcpRuntime();
    const tools = await runtime.mcp.listTools();
    const names = tools.map((tool) => tool.name);

    assert(
      names.includes('system.health'),
      'built-in system.health is available',
    );
    assert(
      !names.some((name) => /^(telegram|google|android|slack)\./u.test(name)),
      'no external account tools are exposed on a fresh install',
    );
    assert(
      !names.some((name) => name.startsWith('calendar.')),
      'mock calendar tools do not ship in production',
    );
  }

  console.log('a UI tap cannot manufacture a connection:');
  {
    await expectError(
      () => connectConnector('google'),
      'connecting a mock-only connector fails in production',
    );

    const telegramError = await expectError(
      () => connectConnector('telegram-user'),
      'Telegram connect fails honestly without the native TDLib build',
    );
    assert(
      /TDLib|native module|development build/iu.test(telegramError),
      'the Telegram failure explains what is missing',
    );

    assert(
      (await getConnectionStore().list()).length === 0,
      'no connection record was created by failed attempts',
    );
  }

  console.log('only a successful auth flow creates a connection:');
  {
    const store = new InMemoryConnectionStore();
    const adapter = new MockTdlibAdapter();
    const connector = new TelegramUserConnector({
      store,
      adapterFactory: () => adapter,
    });

    assert(
      (await connector.listConnections()).length === 0,
      'before auth there is no connection',
    );

    const created = await connector.connect();
    assert(created.status === 'connected', 'a completed auth flow connects');
    assert(
      created.id.startsWith('telegram-user:'),
      'the connection is keyed by the external account',
    );
    assert(
      created.displayName === 'Dev User',
      'the real identity is shown, not a generic label',
    );
    assert(
      (await store.list()).length === 1,
      'the connection is persisted in the store',
    );
  }

  console.log('disconnect removes the connection and its credential:');
  {
    await closeLocalMcpRuntime();
    await getLocalMcpRuntime({ mode: 'development' });

    const store = getConnectionStore();
    const vault = getCredentialVault();

    const seeded = await store.get('telegram-user-default');
    assert(Boolean(seeded), 'dev runtime seeds a labeled mock connection');

    // Stand in for a credential saved during connect.
    await vault.save('tdlib-session:dev', {
      kind: 'tdlib',
      databaseKeyReference: 'dev-key',
    });

    await disconnectConnection('telegram-user-default');

    assert(
      (await store.get('telegram-user-default')) === null,
      'the connection record is gone after disconnect',
    );
    assert(
      (await vault.get('tdlib-session:dev')) === null,
      'the stored credential is revoked on disconnect',
    );

    const runtime = await getLocalMcpRuntime();
    const names = (await runtime.mcp.listTools()).map((tool) => tool.name);
    assert(
      !names.some((name) => name.startsWith('telegram.user.')),
      'Telegram tools disappear after disconnect',
    );
  }

  console.log('expired connections expose no tools:');
  {
    const store = new InMemoryConnectionStore();
    await store.save(
      record({
        id: 'google-expired',
        connectorId: 'google',
        status: 'expired',
      }),
    );

    const registry = createConnectorRegistry({
      mode: 'development',
      connectionStore: store,
    });
    const active = await registry.listActiveTools();

    assert(
      !active.some(({ connection }) => connection.id === 'google-expired'),
      'an expired connection contributes no tools',
    );
  }

  console.log('two accounts coexist and are selected by connectionId:');
  {
    const store = new InMemoryConnectionStore();
    await store.save(
      record({ id: 'google-personal', connectorId: 'google', displayName: 'Personal' }),
    );
    await store.save(
      record({ id: 'google-work', connectorId: 'google', displayName: 'Work' }),
    );

    const registry = new ConnectorRegistry({ allowDevelopmentMocks: true });
    registry.register(new EchoConnector(store));

    const runtime = await createLocalMcpRuntime(
      {
        calendar: {
          async listEvents() {
            return [];
          },
          async createEvent() {
            throw new Error('unused');
          },
        },
        approvals: {
          async assertApproved() {
            throw new Error('unused');
          },
        },
      },
      {
        registry,
        policyEngine: new DefaultPolicyEngine(),
        approvalService: new InMemoryApprovalService(),
      },
      { builtInCalendar: false },
    );

    const tools = await runtime.mcp.listTools();
    const echoTools = tools.filter((tool) => tool.name === 'echo.connection');
    assert(
      echoTools.length === 1,
      'one tool name serves both accounts (no duplicate registration)',
    );

    const personal = await runtime.mcp.callTool({
      name: 'echo.connection',
      arguments: { connectionId: 'google-personal' },
    });
    const work = await runtime.mcp.callTool({
      name: 'echo.connection',
      arguments: { connectionId: 'google-work' },
    });

    assert(
      (personal.structuredContent as { data: { connectionId: string } }).data
        .connectionId === 'google-personal',
      'connectionId selects the personal account',
    );
    assert(
      (work.structuredContent as { data: { connectionId: string } }).data
        .connectionId === 'google-work',
      'connectionId selects the work account',
    );

    const missing = await runtime.mcp
      .callTool({
        name: 'echo.connection',
        arguments: { connectionId: 'google-missing' },
      })
      .catch((error: Error) => error.message);
    assert(
      typeof missing === 'string' && /was not found/iu.test(missing),
      'an unknown connectionId is rejected, not guessed',
    );

    await runtime.close();
  }

  console.log('connections persist across app restarts:');
  {
    const backend = new Map<string, string>();
    const keyValue: KeyValueBackend = {
      async getItem(key) {
        return backend.get(key) ?? null;
      },
      async setItem(key, value) {
        backend.set(key, value);
      },
      async removeItem(key) {
        backend.delete(key);
      },
    };

    const before = new PersistentConnectionStore(keyValue);
    await before.save(
      record({
        id: 'telegram-user:70000000',
        connectorId: 'telegram-user',
        displayName: 'Amin',
        capabilities: ['telegram.messages.send'],
      }),
    );

    // A brand-new store instance over the same storage = an app restart.
    const after = new PersistentConnectionStore(keyValue);
    const restored = await after.list();

    assert(restored.length === 1, 'restart restores persisted connections');
    assert(
      restored[0].displayName === 'Amin' && restored[0].status === 'connected',
      'the restored record keeps identity and status',
    );

    backend.set('creepyim.connections.v1', '{corrupted');
    const corrupted = new PersistentConnectionStore(keyValue);
    assert(
      (await corrupted.list()).length === 0,
      'a corrupted document degrades to an empty store instead of crashing',
    );
  }

  console.log('production registry refuses mock connectors:');
  {
    const store = new InMemoryConnectionStore();
    await store.save(record({ id: 'google-default', connectorId: 'google' }));
    await store.save(record({ id: 'android-device', connectorId: 'android' }));

    const registry = createConnectorRegistry({
      mode: 'production',
      connectionStore: store,
    });

    const ids = registry.listConnectors().map((connector) => connector.id);
    assert(
      !ids.includes('google') && !ids.includes('android'),
      'mock connectors are not registered in production',
    );

    const active = await registry.listActiveTools();
    assert(
      active.length === 0,
      'seeded mock connections expose no tools in production',
    );
  }

  await closeLocalMcpRuntime();

  console.log('verify:connections — all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
