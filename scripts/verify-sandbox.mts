/**
 * The device-side sandbox that runs a translated MCP server.
 *
 * The document this checks is the real one — `sandboxHtml` builds it and the
 * WebView loads exactly that. It runs here inside a `vm` context arranged so
 * `window === globalThis`, as it is in a browser, against a bundle that
 * follows the same contract the backend's shims produce.
 *
 * That contract is the thing worth testing. The preamble lives in this
 * repository and the shims it talks to live in the backend, so they agree only
 * by convention: a bundle that loads but never calls `ready`, or a
 * `process.env` that arrives empty, would look like a fault in the user's
 * server rather than a broken seam. The checks below pin both directions of
 * it — MCP messages, the environment, the server's diagnostics, and the fetch
 * proxy that exists because the guest has no network of its own.
 *
 * Run: npm run verify:sandbox
 */

import vm from 'node:vm';

import { sandboxHtml } from '../src/mcp/custom/sandbox/guest.js';
import { SandboxTransport } from '../src/mcp/custom/sandbox/SandboxTransport.js';

let failures = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    console.log(`  ok — ${message}`);
  } else {
    failures += 1;
    console.error(`  FAIL — ${message}`);
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** A bundle shaped like one the backend produces, including top-level await. */
const BUNDLE_SOURCE = [
  "globalThis.__creepyMcpHost.log('stderr', 'minimal server up');",
  'globalThis.__creepyMcpHost.ready({',
  '  deliver: (message) => {',
  '    globalThis.__creepyMcpHost.receive({',
  "      jsonrpc: '2.0',",
  '      id: message.id,',
  '      result: {',
  '        echoed: message.params,',
  '        key: globalThis.__creepyMcpHost.env.API_KEY,',
  '      },',
  '    });',
  '  },',
  '});',
  // The reason the backend emits ESM and the preamble wraps it in an async
  // function: real MCP servers end with `await server.connect(...)`.
  "const response = await fetch('https://example.test/ping', { method: 'POST', body: 'hi' });",
  "globalThis.__creepyMcpHost.log('stderr', 'fetch:' + (await response.text()));",
].join('\n');

interface Posted {
  t: string;
  [key: string]: unknown;
}

function loadSandbox(bundleSource: string, environment: Record<string, string>) {
  const html = sandboxHtml(
    Buffer.from(bundleSource, 'utf8').toString('base64'),
    environment,
  );

  const posted: Posted[] = [];
  const scope: Record<string, unknown> = {};
  // In a browser these are the same object, and the preamble relies on it:
  // it assigns to `window.__creepyMcpHost` and the bundle reads
  // `globalThis.__creepyMcpHost`.
  scope.window = scope;
  scope.atob = (input: string) => Buffer.from(input, 'base64').toString('binary');
  scope.TextDecoder = TextDecoder;
  scope.Uint8Array = Uint8Array;
  scope.console = console;
  scope.addEventListener = () => {};
  scope.ReactNativeWebView = {
    postMessage: (raw: string) => posted.push(JSON.parse(raw) as Posted),
  };

  const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gu)];
  const inert = blocks.find((block) => block[1]!.includes('text/plain'));
  scope.document = { getElementById: () => ({ textContent: inert?.[2] ?? '' }) };

  vm.createContext(scope);
  for (const block of blocks) {
    if (block[1]!.includes('text/plain')) continue;
    vm.runInContext(block[2]!, scope);
  }

  return { posted, scope, html };
}

async function checkSandboxDocument(): Promise<void> {
  const { posted, scope, html } = loadSandbox(BUNDLE_SOURCE, {
    API_KEY: 'secret-from-vault',
  });

  assert(
    html.includes('secret-from-vault'),
    'the environment reaches the document',
  );

  await tick();

  const request = posted.find((message) => message.t === 'fetch') as
    | { id: number; url: string; init: { method: string; body: string } }
    | undefined;
  assert(request !== undefined, 'the guest routes fetch through the host, not the network');
  assert(request?.url === 'https://example.test/ping', 'the URL crosses the boundary intact');
  assert(request?.init.method === 'POST', 'and the method');
  assert(request?.init.body === 'hi', 'and the body');

  const result = JSON.stringify({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {},
    body: 'pong',
  });
  vm.runInContext(
    `window.__creepyFetchResult(${request!.id}, JSON.parse(${JSON.stringify(result)}));`,
    scope,
  );
  await tick();

  assert(
    posted.some((message) => message.t === 'ready'),
    'the bundle connects a transport and the host is told',
  );

  const logs = posted.filter((message) => message.t === 'log');
  assert(
    logs.some((message) => String(message.text).includes('minimal server up')),
    "the server's own diagnostics reach the host rather than vanishing",
  );
  assert(
    logs.some((message) => String(message.text).includes('fetch:pong')),
    'the proxied response is delivered back into the sandbox',
  );

  // Host to guest and back: the direction an actual tool call travels.
  const outbound = JSON.stringify({
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/list',
    params: { probe: true },
  });
  vm.runInContext(
    `window.__creepyDeliver(JSON.parse(${JSON.stringify(outbound)}));`,
    scope,
  );
  await tick();

  const reply = posted.find(
    (message) => message.t === 'mcp' && (message.message as { id?: number })?.id === 7,
  );
  assert(reply !== undefined, 'a message delivered to the guest comes back answered');

  const payload = (reply?.message as { result?: { echoed: unknown; key: string } })?.result;
  assert(
    JSON.stringify(payload?.echoed) === JSON.stringify({ probe: true }),
    'params survive the round trip',
  );
  // The whole env path in one assertion: backend injected `process`, the
  // preamble filled it from the credential vault, the server read it.
  assert(
    payload?.key === 'secret-from-vault',
    'the server reads the environment the user supplied',
  );

  assert(
    !posted.some((message) => message.t === 'error'),
    'nothing in the document errored',
  );
}

async function checkTheGuestHasNoAmbientAuthority(): Promise<void> {
  const probe = [
    'let storage = "unreadable";',
    'try { storage = String(window.localStorage); } catch (error) { storage = "refused"; }',
    "globalThis.__creepyMcpHost.log('probe', storage);",
    'globalThis.__creepyMcpHost.ready({ deliver: () => {} });',
  ].join('\n');

  const { posted } = loadSandbox(probe, {});
  await tick();

  const log = posted.find((message) => message.t === 'log');
  assert(
    String(log?.text) === 'refused',
    'localStorage is refused rather than quietly emulated',
  );
}

async function checkConsoleIsCaptured(): Promise<void> {
  const probe = [
    "console.error('boxed status line');",
    "console.log('plain', { a: 1 });",
    'globalThis.__creepyMcpHost.ready({ deliver: () => {} });',
  ].join('\n');

  const { posted } = loadSandbox(probe, {});
  await tick();

  const logs = posted.filter((message) => message.t === 'log');
  assert(
    logs.some((message) => String(message.text) === 'boxed status line'),
    'console.error is captured — most servers log through it, not process.stderr',
  );
  assert(
    logs.some((message) => String(message.text) === 'plain {"a":1}'),
    'non-string console arguments are rendered rather than dropped',
  );
}

async function checkAFailingBundleIsReported(): Promise<void> {
  const { posted } = loadSandbox('throw new Error("this server is broken");', {});
  await tick();

  const error = posted.find((message) => message.t === 'error');
  assert(error !== undefined, 'a bundle that throws reports an error rather than hanging');
  assert(
    String(error?.message).includes('this server is broken'),
    "and the server's own message survives",
  );
  assert(
    !posted.some((message) => message.t === 'ready'),
    'a bundle that never connects is never reported ready',
  );
}

/**
 * The host injects messages as JavaScript source. A payload containing a
 * quote, a backslash or a newline must not be able to end the expression —
 * which interpolating raw JSON would allow on the first string with a quote.
 */
function checkInjectionEscaping(): void {
  const nasty = {
    text: 'he said "hi" \\ and \' then\nnewline <\/script>',
    nested: { a: ['</script>', '`${}`'], b: '  ' },
  };

  let delivered: unknown = null;
  const transport = new SandboxTransport((message) => {
    const literal = JSON.stringify(JSON.stringify(message));
    const scope: Record<string, unknown> = {};
    vm.createContext(scope);
    vm.runInContext(`globalThis.out = JSON.parse(${literal});`, scope);
    delivered = scope.out;
  });

  void transport.send(nasty);
  assert(
    JSON.stringify(delivered) === JSON.stringify(nasty),
    'quotes, backslashes and newlines survive injection intact',
  );
}

async function checkTransportLifecycle(): Promise<void> {
  const sent: unknown[] = [];
  const transport = new SandboxTransport((message) => sent.push(message));

  let received: unknown = null;
  transport.onmessage = (message) => {
    received = message;
  };
  let closed = false;
  transport.onclose = () => {
    closed = true;
  };

  await transport.start();
  await transport.start();
  await transport.send({ id: 1 });
  assert(sent.length === 1, 'starting twice does not duplicate the connection');

  transport.receive({ id: 2 });
  assert((received as { id: number })?.id === 2, 'incoming messages reach the client');

  await transport.close();
  assert(closed, 'closing notifies the client');
  transport.receive({ id: 3 });
  assert((received as { id: number })?.id === 2, 'a closed transport delivers nothing further');

  const rejected = await transport
    .send({ id: 4 })
    .then(() => null)
    .catch((error: unknown) => error);
  assert(rejected instanceof Error, 'and sending after close fails rather than silently dropping');
}


/**
 * An environment value containing a closing script tag must not be able to end
 * the element it sits in. JSON.stringify does not escape `<`, so this is not
 * free.
 */
async function checkHostileEnvironmentValue(): Promise<void> {
  const hostile = '</' + 'script><script>globalThis.__escaped = true;</' + 'script>';
  const { posted, scope } = loadSandbox(
    [
      "globalThis.__creepyMcpHost.log('probe', globalThis.__creepyMcpHost.env.EVIL);",
      'globalThis.__creepyMcpHost.ready({ deliver: () => {} });',
    ].join('\n'),
    { EVIL: hostile },
  );
  await tick();

  assert(
    (scope as { __escaped?: boolean }).__escaped !== true,
    'an environment value cannot break out of its script element',
  );
  const log = posted.find((message) => message.t === 'log');
  assert(
    String(log?.text) === hostile,
    'and it still arrives at the server exactly as the user typed it',
  );
}

async function main(): Promise<void> {
  console.log('the sandbox document:');
  await checkSandboxDocument();

  console.log('\nhostile environment values:');
  await checkHostileEnvironmentValue();

  console.log('\nno ambient authority:');
  await checkTheGuestHasNoAmbientAuthority();

  console.log('\nconsole capture:');
  await checkConsoleIsCaptured();

  console.log('\nfailure reporting:');
  await checkAFailingBundleIsReported();

  console.log('\ninjection escaping:');
  checkInjectionEscaping();

  console.log('\ntransport lifecycle:');
  await checkTransportLifecycle();

  if (failures > 0) {
    console.error(`\nsandbox: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nverify:sandbox — all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
