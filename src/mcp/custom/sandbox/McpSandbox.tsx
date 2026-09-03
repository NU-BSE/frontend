import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { SandboxTransport } from './SandboxTransport';
import { sandboxHtml, type GuestMessage, type HostFetchResult } from './guest';

/**
 * Runs one translated MCP server inside a WebView.
 *
 * The WebView is not a rendering detail — it is the isolation boundary. A
 * translated server is third-party code from a repository the user pasted, and
 * the app's own JavaScript context holds the credential vault, the agent and
 * every connector. Evaluating the server there would give it all of that. In a
 * WebView it gets a separate renderer with a null origin and no handle to any
 * of it; the only way across is JSON over postMessage.
 *
 * The view is zero-sized and never seen. It still has to be mounted in the
 * tree, which has a consequence worth stating plainly: a server runs only
 * while the app is in the foreground with this component mounted. Nothing here
 * survives backgrounding, and nothing should be written that assumes it does.
 */
export interface McpSandboxProps {
  /** Content-addressed bundle, already verified against its digest. */
  bundleBase64: string;
  /** Values from the credential vault; becomes the server's process.env. */
  environment: Record<string, string>;
  /** Called once the server has connected its transport and is ready. */
  onReady: (transport: SandboxTransport) => void;
  /** Server diagnostics — its stderr and console. Never its data. */
  onLog?: (stream: string, text: string) => void;
  onError?: (error: Error) => void;
  /**
   * Decides whether the server may make a request, and performs it.
   *
   * The guest has no network of its own, so every call arrives here. Returning
   * a rejection is how a server gets told no.
   */
  onFetch?: (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<HostFetchResult>;
}

/** Requests the guest makes are performed here, with the app's own fetch. */
async function defaultFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<HostFetchResult> {
  try {
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      ...(init.headers ? { headers: init.headers } : {}),
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers,
      body: await response.text(),
    };
  } catch (error) {
    // Reported as a rejected request rather than thrown: the guest is waiting
    // on a promise, and leaving it pending would hang the tool call forever.
    return {
      ok: false,
      status: 0,
      statusText: '',
      headers: {},
      body: '',
      error: error instanceof Error ? error.message : 'Network request failed',
    };
  }
}

export function McpSandbox({
  bundleBase64,
  environment,
  onReady,
  onLog,
  onError,
  onFetch,
}: McpSandboxProps) {
  const webViewRef = useRef<WebView>(null);
  const transportRef = useRef<SandboxTransport | null>(null);

  /*
   * The transport is created on first use rather than during render, because
   * its send closure reaches for the WebView and a ref must not be read while
   * rendering. Everything that calls this — the message handler, the cleanup
   * effect — already runs after mount.
   */
  const getTransport = useCallback((): SandboxTransport => {
    if (!transportRef.current) {
      transportRef.current = new SandboxTransport((message) => {
        /*
         * JSON.stringify twice, deliberately. The inner call produces the
         * message; the outer one produces a *JavaScript string literal* of it,
         * so quotes and backslashes inside the payload cannot terminate the
         * expression being injected. Interpolating the raw JSON is the obvious
         * shortcut and breaks on the first string containing a quote.
         */
        const literal = JSON.stringify(JSON.stringify(message));
        webViewRef.current?.injectJavaScript(
          `window.__creepyDeliver(JSON.parse(${literal})); true;`,
        );
      });
    }
    return transportRef.current;
  }, []);

  // Built once. Rebuilding it would reload the WebView and restart the server
  // mid-conversation, losing whatever state it holds.
  const html = useMemo(
    () => sandboxHtml(bundleBase64, environment),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    return () => {
      void transportRef.current?.close();
    };
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let parsed: GuestMessage;
      try {
        parsed = JSON.parse(event.nativeEvent.data) as GuestMessage;
      } catch {
        // The guest is the only writer here and it always sends JSON, so this
        // is a corrupted channel rather than a protocol variation.
        onError?.(new Error('The MCP sandbox sent something unreadable.'));
        return;
      }

      switch (parsed.t) {
        case 'ready':
          onReady(getTransport());
          return;
        case 'mcp':
          getTransport().receive(parsed.message);
          return;
        case 'log':
          onLog?.(parsed.stream, parsed.text);
          return;
        case 'error': {
          const error = new Error(parsed.message);
          if (parsed.stack) error.stack = parsed.stack;
          getTransport().fail(error);
          onError?.(error);
          return;
        }
        case 'fetch': {
          const perform = onFetch ?? defaultFetch;
          void perform(parsed.url, parsed.init).then((result) => {
            const literal = JSON.stringify(JSON.stringify(result));
            webViewRef.current?.injectJavaScript(
              `window.__creepyFetchResult(${parsed.id}, JSON.parse(${literal})); true;`,
            );
          });
          return;
        }
      }
    },
    [getTransport, onError, onFetch, onLog, onReady],
  );

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={webViewRef}
        source={{ html }}
        originWhitelist={['about:blank']}
        javaScriptEnabled
        // Nothing about this document should survive it, and nothing it does
        // should be reachable from another one.
        domStorageEnabled={false}
        thirdPartyCookiesEnabled={false}
        sharedCookiesEnabled={false}
        cacheEnabled={false}
        incognito
        // The guest has no network; every request goes through onFetch. This
        // refuses the ones a script tag or a stylesheet could still attempt.
        onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
        onMessage={handleMessage}
        onError={() => onError?.(new Error('The MCP sandbox failed to load.'))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Zero-sized rather than display:none — a WebView that is not laid out does
  // not reliably run its JavaScript on Android.
  hidden: { width: 0, height: 0, opacity: 0, position: 'absolute' },
});
