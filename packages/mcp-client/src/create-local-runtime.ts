import {
  Client,
  InMemoryTransport,
} from "@modelcontextprotocol/client";

import type {
  MobileAgentDependencies,
} from "@mobile-agent/connector-core";

import {
  createMobileAgentMcpServer,
} from "@mobile-agent/mcp-server";

import {
  AgentMcpClient,
} from "./agent-mcp-client";

export interface LocalMcpRuntime {
  rawClient: Client;
  mcp: AgentMcpClient;
  close(): Promise<void>;
}

/**
 * Поднимает MCP client и MCP server
 * внутри одного JavaScript-процесса
 * и соединяет их через InMemoryTransport.
 *
 * Без сети, localhost и child_process.
 */
export async function createLocalMcpRuntime(
  dependencies: MobileAgentDependencies,
): Promise<LocalMcpRuntime> {
  const server =
    createMobileAgentMcpServer(dependencies);

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
