import {
  Client,
  InMemoryTransport,
} from "@modelcontextprotocol/client";

import type {
  MobileAgentDependencies,
} from "@mobile-agent/connector-core";

import {
  createMobileAgentMcpServer,
  registerConnectorTools,
} from "@mobile-agent/mcp-server";

import type {
  ConnectorRegistry,
} from "@mobile-agent/connector-registry";

import type {
  PolicyEngine,
} from "@mobile-agent/policy-core";

import type {
  ApprovalService,
} from "@mobile-agent/approval-core";

import {
  AgentMcpClient,
} from "./agent-mcp-client";

export interface LocalMcpRuntime {
  rawClient: Client;
  mcp: AgentMcpClient;
  close(): Promise<void>;
}

/**
 * Подключение connectors к тому же runtime.
 *
 * Передаётся целиком или не передаётся вовсе:
 * без policy engine и approval service
 * connector tools регистрировать нельзя.
 */
export interface LocalMcpConnectors {
  registry: ConnectorRegistry;
  policyEngine: PolicyEngine;
  approvalService: ApprovalService;
}

export interface LocalMcpRuntimeOptions {
  /**
   * Built-in calendar tools are mock-backed today; production runtimes turn
   * them off so the model never acts against `mock-personal`.
   */
  builtInCalendar?: boolean;
}

/**
 * Поднимает MCP client и MCP server
 * внутри одного JavaScript-процесса
 * и соединяет их через InMemoryTransport.
 *
 * Без сети, localhost и child_process.
 *
 * Если передан `connectors`, инструменты всех
 * подключённых connectors регистрируются
 * на том же сервере, рядом с `system.health`
 * и calendar-инструментами.
 */
export async function createLocalMcpRuntime(
  dependencies: MobileAgentDependencies,
  connectors?: LocalMcpConnectors,
  options: LocalMcpRuntimeOptions = {},
): Promise<LocalMcpRuntime> {
  const server =
    createMobileAgentMcpServer(dependencies, {
      builtInCalendar: options.builtInCalendar,
    });

  /*
   * Строго до server.connect:
   * инструменты, зарегистрированные после connect,
   * не попадут в первый listTools.
   */
  if (connectors) {
    await registerConnectorTools(
      server,
      connectors.registry,
      connectors.policyEngine,
      connectors.approvalService,
    );
  }

  const rawClient = new Client({
    name: "mobile-agent-local-client",
    version: "0.1.0",
  });

  /*
   * Обе половины linked pair создаются
   * одним импортом InMemoryTransport.
   */
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  /*
   * Tools регистрируются внутри
   * createMobileAgentMcpServer до connect,
   * иначе listTools вернёт пустой список.
   */
  await server.connect(serverTransport);
  await rawClient.connect(clientTransport);

  const mcp = new AgentMcpClient(rawClient);

  let closed = false;

  return {
    rawClient,
    mcp,

    async close(): Promise<void> {
      if (closed) {
        return;
      }

      closed = true;

      await rawClient.close();
      await server.close();
    },
  };
}
