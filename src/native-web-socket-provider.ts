import { UrlProviderFn, getComponent } from '@sektek/utility-belt';

import {
  WebSocketLike,
  WebSocketProvider,
  WebSocketProviderOptions,
} from './types/index.js';

/**
 * Options for `NativeWebSocketProvider`.
 *
 * Extends {@link WebSocketProviderOptions} with browser-specific options.
 */
export type NativeWebSocketProviderOptions = WebSocketProviderOptions & {
  /** Optional subprotocol(s) to negotiate. */
  protocol?: string | string[];
};

/**
 * Browser-native WebSocket provider.
 *
 * Lazily opens a single `WebSocket` connection on the first `get()` call and
 * nulls it on close, so the next `get()` reconnects automatically. The
 * `urlProvider` is called fresh on every new connection so session URLs are
 * always current.
 *
 * Note: the browser `WebSocket` API does not support custom request headers.
 * For header-based auth (e.g. `Authorization`) use `WsWebSocketProvider`
 * (Node.js) with its `headersProvider` option, or encode credentials in the
 * URL via a session URL returned by `urlProvider`.
 */
export class NativeWebSocketProvider implements WebSocketProvider {
  #ws: WebSocket | null = null;
  #pending: Promise<WebSocket> | null = null;
  #urlProvider: UrlProviderFn<void>;
  #protocol: string | string[] | undefined;

  constructor(opts: NativeWebSocketProviderOptions) {
    if (!opts.urlProvider && !opts.url) {
      throw new Error('Must provide either urlProvider or url');
    }
    this.#urlProvider = getComponent(opts.urlProvider, 'get', {
      default: () => opts.url!,
    });
    this.#protocol = opts.protocol;
  }

  /**
   * Open (or reuse) the underlying WebSocket and return it as `WebSocketLike`.
   *
   * Concurrent calls while a connection is being established all share the same
   * in-flight promise so only one socket is ever created.
   *
   * @returns The active `WebSocketLike` connection.
   */
  async get(): Promise<WebSocketLike> {
    if (this.#ws) return this.#ws;

    if (!this.#pending) {
      this.#pending = (async () => {
        try {
          return await this.#createSocket();
        } catch (err) {
          this.#pending = null;
          throw err;
        }
      })();
    }

    return this.#pending;
  }

  async #createSocket(): Promise<WebSocket> {
    const url = await this.#urlProvider();
    const ws = new WebSocket(url as string | URL, this.#protocol);

    ws.addEventListener('close', () => {
      this.#ws = null;
      this.#pending = null;
    });

    this.#ws = ws;
    return ws;
  }
}
