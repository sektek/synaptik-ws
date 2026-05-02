import { WebSocketLike } from './types/index.js';

/** Options for `NativeWebSocketProvider`. */
export type NativeWebSocketProviderOptions = {
  /** URL to connect to. */
  url: string | URL;
  /** Optional subprotocol(s) to negotiate. */
  protocol?: string | string[];
};

/**
 * Browser-native WebSocket provider.
 *
 * Lazily opens a single `WebSocket` connection on the first `get()` call and
 * nulls it on close, so the next `get()` reconnects automatically.
 */
export class NativeWebSocketProvider {
  #ws: WebSocket | null = null;
  #url: string | URL;
  #protocol: string | string[] | undefined;

  constructor(opts: NativeWebSocketProviderOptions) {
    this.#url = opts.url;
    this.#protocol = opts.protocol;
  }

  /**
   * Open (or reuse) the underlying WebSocket and return it as `WebSocketLike`.
   *
   * @returns The active `WebSocketLike` connection.
   */
  get(): WebSocketLike {
    if (!this.#ws) {
      this.#ws = new WebSocket(this.#url, this.#protocol);
      this.#ws.addEventListener('close', () => {
        this.#ws = null;
      });
    }
    return this.#ws;
  }
}
