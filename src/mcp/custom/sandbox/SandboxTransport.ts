/**
 * An MCP transport whose other end is a WebView.
 *
 * The official client SDK talks to a server through a `Transport`: something
 * that can start, send a JSON-RPC message, and report messages coming back.
 * That is the whole interface, and it says nothing about processes or pipes —
 * which is why a sandbox on the far side of `postMessage` fits it exactly.
 *
 * Implementing this rather than hand-rolling JSON-RPC means the app gets the
 * SDK's protocol handling — request ids, the initialize handshake, progress
 * and cancellation — against a server that is running inside a WebView on the
 * same device.
 */

export type TransportSend = (message: unknown) => void;

export class SandboxTransport {
  onmessage?: (message: unknown) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  private started = false;
  private closed = false;

  /**
   * `send` hands a message to the sandbox. It is supplied rather than owned
   * because the WebView it writes to is a React ref that outlives no single
   * transport, and a transport that reached for the view directly could not be
   * tested without one.
   */
  constructor(private readonly deliver: TransportSend) {}

  async start(): Promise<void> {
    // The SDK calls start() from connect(); a second call must not reset state.
    if (this.started) return;
    this.started = true;
  }

  async send(message: unknown): Promise<void> {
    if (this.closed) throw new Error('The MCP sandbox is closed.');
    this.deliver(message);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  /** Called by the host for every message the sandbox produced. */
  receive(message: unknown): void {
    if (this.closed) return;
    try {
      this.onmessage?.(message);
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Called by the host when the sandbox failed rather than replied. */
  fail(error: Error): void {
    this.onerror?.(error);
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
