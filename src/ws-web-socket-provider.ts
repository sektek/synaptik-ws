import { WebSocket } from 'ws';

import { WebSocketLike } from './types/index.js';

/** Options for `WsWebSocketProvider`. */
type WsWebSocketProviderOptions = {
  /** URL to connect to. */
  url: string;
};

/**
 * Node.js WebSocket provider backed by the `ws` package.
 *
 * Lazily opens a single connection on the first `get()` call and nulls it on
 * close, so the next `get()` reconnects automatically.
 */
export class WsWebSocketProvider {
  #ws: WebSocket | null = null;
  #url: string;

  constructor(opts: WsWebSocketProviderOptions) {
    this.#url = opts.url;
  }

  /**
   * Open (or reuse) the underlying `ws.WebSocket` and return it as `WebSocketLike`.
   *
   * @returns The active `WebSocketLike` connection.
   */
  get(): WebSocketLike {
    if (!this.#ws) {
      this.#ws = new WebSocket(this.#url);
      this.#ws.on('close', () => {
        this.#ws = null;
      });
    }
    return this.#ws as unknown as WebSocketLike;
  }
}
