/**
 * The code that runs *inside* the sandbox.
 *
 * This is a string on purpose: it is never part of the app's bundle at
 * runtime, it is the document a WebView loads. That WebView is the isolation
 * boundary — a separate renderer with its own origin, holding none of the
 * app's JavaScript. A translated MCP server is third-party code from a URL the
 * user pasted, and evaluating it in the app's own context would hand it the
 * credential vault, the agent and every module in the bundle. It cannot reach
 * any of those from here.
 *
 * The guest is given no ambient authority at all:
 *
 * * **No network of its own.** `fetch` is replaced by a proxy that asks the
 *   host to make the request. That is partly policy — the host can see, log
 *   and refuse what a server talks to — and partly the only thing that works:
 *   a document with a null origin has every cross-origin API call rejected by
 *   CORS, so a server left with the real `fetch` would fail against precisely
 *   the APIs it exists to call.
 * * **No storage.** localStorage and friends are removed rather than shimmed;
 *   a server that wants to persist something should be told so plainly instead
 *   of writing into a store the user cannot see.
 * * **Only the environment the user supplied.** `process.env` is populated
 *   from the values in the credential vault for this server, and nothing else.
 *
 * Everything crosses the boundary as JSON over postMessage. Nothing else can.
 */

/** Messages the guest sends out. */
export type GuestMessage =
  | { t: 'ready' }
  | { t: 'mcp'; message: unknown }
  | { t: 'log'; stream: string; text: string }
  | { t: 'fetch'; id: number; url: string; init: GuestFetchInit }
  | { t: 'error'; message: string; stack?: string };

export interface GuestFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HostFetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  error?: string;
}

/**
 * The preamble, evaluated before the server bundle.
 *
 * Written as ES5-ish source with no build step: it is injected as text, so
 * anything the WebView's JavaScript engine does not understand is a syntax
 * error at load with nowhere useful to report it.
 */
const PREAMBLE = String.raw`
(function () {
  var post = function (message) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  };

  var transport = null;
  var pendingFetches = {};
  var nextFetchId = 1;

  // Deny storage rather than emulate it. A server that quietly writes to a
  // store nobody can inspect is worse than one that fails loudly.
  try {
    Object.defineProperty(window, 'localStorage', { get: function () {
      throw new Error('This MCP server tried to use localStorage, which the sandbox does not provide.');
    } });
    Object.defineProperty(window, 'sessionStorage', { get: function () {
      throw new Error('This MCP server tried to use sessionStorage, which the sandbox does not provide.');
    } });
  } catch (error) { /* some engines make these non-configurable */ }

  // The host performs every request. See the note at the top of guest.ts: this
  // is both the policy hook and the only way a null-origin document can reach
  // an ordinary API at all.
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url);
    var options = init || {};
    var headers = {};
    if (options.headers) {
      if (typeof options.headers.forEach === 'function') {
        options.headers.forEach(function (value, key) { headers[key] = value; });
      } else {
        Object.keys(options.headers).forEach(function (key) {
          headers[key] = String(options.headers[key]);
        });
      }
    }

    var id = nextFetchId++;
    return new Promise(function (resolve, reject) {
      pendingFetches[id] = { resolve: resolve, reject: reject };
      post({
        t: 'fetch',
        id: id,
        url: String(url),
        init: {
          method: options.method || 'GET',
          headers: headers,
          body: typeof options.body === 'string' ? options.body : undefined,
        },
      });
    });
  };

  window.__creepyFetchResult = function (id, result) {
    var pending = pendingFetches[id];
    if (!pending) return;
    delete pendingFetches[id];
    if (result.error) {
      pending.reject(new Error(result.error));
      return;
    }
    pending.resolve({
      ok: result.ok,
      status: result.status,
      statusText: result.statusText,
      headers: {
        get: function (name) {
          var key = String(name).toLowerCase();
          return Object.prototype.hasOwnProperty.call(result.headers, key)
            ? result.headers[key]
            : null;
        },
      },
      text: function () { return Promise.resolve(result.body); },
      json: function () { return Promise.resolve(JSON.parse(result.body)); },
    });
  };

  // Capture console as well as process.stderr. Real servers overwhelmingly log
  // through console — the official sequential-thinking server draws its whole
  // status box with console.error — and in a WebView that output goes nowhere
  // a user or a developer can see it. The original is still called so a
  // browser devtools session shows it too.
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      var text = Array.prototype.map
        .call(arguments, function (argument) {
          if (typeof argument === 'string') return argument;
          try {
            return JSON.stringify(argument);
          } catch (error) {
            return String(argument);
          }
        })
        .join(' ');
      post({ t: 'log', stream: 'console.' + level, text: text });
      if (original) original.apply(console, arguments);
    };
  });

  // The contract the translated bundle's shims expect. See
  // app/services/mcp_host/ in the backend: the stdio transport was aliased to
  // something that calls ready(), and process was injected to read env.
  window.__creepyMcpHost = {
    env: window.__CREEPY_ENV__ || {},
    log: function (stream, text) { post({ t: 'log', stream: stream, text: text }); },
    ready: function (t) { transport = t; post({ t: 'ready' }); },
    receive: function (message) { post({ t: 'mcp', message: message }); },
  };

  window.__creepyDeliver = function (message) {
    if (transport) transport.deliver(message);
  };

  var report = function (error) {
    post({
      t: 'error',
      message: (error && error.message) ? String(error.message) : String(error),
      stack: error && error.stack ? String(error.stack) : undefined,
    });
  };

  window.addEventListener('error', function (event) { report(event.error || event.message); });
  window.addEventListener('unhandledrejection', function (event) { report(event.reason); });

  window.__creepyStart = function (base64) {
    try {
      // Decoded here rather than passed as source. A bundle can contain a
      // closing script tag inside a string literal, which would end the
      // enclosing tag early and truncate everything after it. The base64
      // alphabet cannot express one, so there is nothing to escape.
      //
      // The tag is not written out even in this comment: the preamble is
      // itself inlined into a script element, so a literal one here would
      // truncate the document exactly as described. That is not hypothetical
      // — it is how this comment was found.
      var binary = atob(base64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var code = new TextDecoder('utf-8').decode(bytes);

      // The bundle is ESM with every import inlined, so it has no module
      // syntax — which is what lets it become an async function body, where
      // its top-level await is simply an await. See the backend's translate().
      var run = new Function('return (async function () {\n' + code + '\n})()');
      Promise.resolve(run()).catch(report);
    } catch (error) {
      report(error);
    }
  };
})();
`;

/**
 * JSON safe to place inside a script element.
 *
 * `JSON.stringify` escapes quotes and backslashes but not `<`, so a value
 * containing a closing script tag would end the element early and everything
 * after it — the preamble, the bundle — would be parsed as markup. Escaping
 * the angle bracket as \u003c keeps the JSON identical to a parser while
 * making it impossible to express a tag.
 *
 * The values here come from the user's own credential vault, which is why this
 * is a correctness fix rather than an injection one; but the failure mode is a
 * sandbox that silently does not load, and that is worth foreclosing.
 */
function jsonForScriptTag(value: unknown): string {
  return JSON.stringify(value).replace(/</gu, '\\u003c');
}

/**
 * The document the sandbox loads.
 *
 * The bundle rides in a `text/plain` script tag as base64, which the preamble
 * decodes. `default-src 'none'` in the CSP is deliberate belt-and-braces: the
 * fetch proxy already means the guest makes no requests of its own, and this
 * makes an image tag or a stylesheet reference fail too.
 */
export function sandboxHtml(bundleBase64: string, environment: Record<string, string>): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'">
</head><body>
<script>window.__CREEPY_ENV__ = ${jsonForScriptTag(environment)};</script>
<script>${PREAMBLE}</script>
<script id="bundle" type="text/plain">${bundleBase64}</script>
<script>window.__creepyStart(document.getElementById('bundle').textContent.trim());</script>
</body></html>`;
}
