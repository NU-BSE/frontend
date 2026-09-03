# @mobile-agent/mcp-resolver

Universal stdio MCP server resolver + framework adapter for the Creepy.IM agent.

```
resolver-core (Kotlin/JVM, resolver/)   — detection + resolution
        ↓ JSON stdio
this package (TypeScript adapter)        — spawns resolver-cli, connects via
                                          @modelcontextprotocol/client
        ↓
existing agent (src/agent, AgentMcpClient)
```

Two layers, strictly separated:

- **Resolution** (`KotlinCliResolver`) — turns a `McpSource` (git repository URL
  or local directory) into a structured `ResolvedMcp` (command, args, working
  directory, required env variables). No agent knowledge.
- **Framework adapter** (`createMcpToolset`) — takes a `ResolvedMcp`, spawns the
  server via the official `StdioClientTransport`, performs the `initialize`
  handshake and `tools/list`, and exposes an `AgentMcpClient` the existing agent
  consumes directly. No detection/resolution knowledge.

## Usage

```ts
import {
  createMcpToolset,
  resolveMcp,
} from '@mobile-agent/mcp-resolver';

const resolved = await resolveMcp({
  type: 'repository',
  url: 'https://github.com/example/example-mcp',
});

console.log(resolved.command, resolved.args);

const toolset = await createMcpToolset(resolved, {
  environment: { GITHUB_TOKEN: process.env.GITHUB_TOKEN }, // caller-owned secrets
  logger: (line) => console.log('[server]', line),
});

const tools = await toolset.listTools();       // handshake verification
const result = await toolset.callTool({ name: 'echo', arguments: { text: 'hi' } });

await toolset.close();                         // graceful shutdown + force-kill
```

The returned toolset is an `AgentMcpClient`, so it plugs straight into the
existing runtime:

```ts
const agent = new AgentRuntime({
  model,
  mcp: toolset.mcp,
  connections,
  approveApproval,
});
```

`McpToolsetManager` keeps one process per resolved server and closes everything
on application shutdown (no duplicate/zombie processes):

```ts
const manager = new McpToolsetManager({ logger });
const toolset = await manager.get('github', resolved);
await manager.closeAll();
```

## Resolver CLI

Resolution runs in the Kotlin `resolver-cli` binary. `locateCli()` finds it in
this order:

1. `MCP_RESOLVER_CLI` environment variable;
2. the Gradle `installDist` launcher (`resolver/build/install/resolver-cli/…`);
3. `java -jar` against `resolver/build/libs/mcp-resolver-0.1.0-fat.jar`
   (with a WSL fallback for Windows Node + Linux JVM);
4. `resolver-cli` on PATH.

Build it with `npm run build:resolver` (or `cd resolver && ./gradlew
installDist fatJar`). The adapter retries the next candidate when a spawn fails,
so a missing local JVM does not break a PATH-based setup.

## Environment variables

The resolver reports which variables a server needs (`requiredEnvironmentVariables` —
names only, never values). `createMcpToolset` merges caller-supplied values onto a
safe base environment and fails with a structured `MissingEnvironment` error if a
required variable has no value:

```
Missing required environment variable: GITHUB_TOKEN
```

## Lifecycle & safety

- `createMcpToolset` spawns exactly one process; `close()` performs a graceful
  shutdown and force-kills (SIGKILL) after a bounded grace period.
- `stdout`/`stdin` carry the MCP protocol; `stderr` is piped and read with
  bounded buffering (`logger`).
- The `initialize` handshake and `tools/list` are the startup probe — console
  output alone is never treated as "server started".
- Commands/args are validated structurally (`commandSafety`) — never assembled
  into a shell string.
- Secrets never enter the resolver CLI and never reach logs.

## Tests

```bash
npx jest --runInBand            # unit + framework-adapter integration (real stdio server)
npm run verify:resolver         # end-to-end: Kotlin CLI → resolution → handshake → tools
```

`verify:resolver` skips with a build hint when the Kotlin CLI is not available.