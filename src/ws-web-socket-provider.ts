import {
  HeadersProviderComponent,
  HeadersProviderFn,
  UrlProviderFn,
  getComponent,
} from '@sektek/utility-belt';
import { type HeadersInit } from 'undici-types';
import { WebSocket } from 'ws';

import {
  WebSocketLike,
  WebSocketProvider,
  WebSocketProviderOptions,
  WebSocketReadyState,
} from './types/index.js';

/**
 * Options for `WsWebSocketProvider`.
 *
 * Extends {@link WebSocketProviderOptions} with Node.js-specific options.
 */
export type WsWebSocketProviderOptions = WebSocketProviderOptions & {
  /**
   * Provider called before each new connection to supply HTTP upgrade request
   * headers (e.g. `Authorization`). Called fresh on every reconnect so tokens
   * are always up-to-date.
   *
   * Note: the native browser `WebSocket` API does not support custom request
   * headers. Use this option only with `WsWebSocketProvider` (Node.js).
   */
  headersProvider?: HeadersProviderComponent;
};

/**
 * Converts a `HeadersInit` value to the plain string record that `ws` expects.
 *
 * @param init - The headers to convert.
 * @returns A plain `Record<string, string>`.
 */
function toHeadersRecord(init: HeadersInit): Record<string, string> {
  if (init instanceof Headers) {
    const result: Record<string, string> = {};
    init.forEach((value, name) => {
      result[name] = value;
    });
    return result;
  }

  if (Array.isArray(init)) {
    return Object.fromEntries(init);
  }

  const result: Record<string, string> = {};

  for (const [name, value] of Object.entries(init)) {
    result[name] = Array.isArray(value) ? value.join(', ') : (value as string);
  }

  return result;
}

/**
 * Node.js WebSocket provider backed by the `ws` package.
 *
 * Lazily opens a single connection on the first `get()` call and forgets it on
 * close, so the next `get()` reconnects automatically. Both `urlProvider` and
 * `headersProvider` are called fresh on every new connection so session URLs
 * and auth tokens are always current.
 */
export class WsWebSocketProvider implements WebSocketProvider {
  #ws: WebSocket | null = null;
  #pending: Promise<WebSocket> | null = null;
  #urlProvider: UrlProviderFn<void>;
  #headersProvider: HeadersProviderFn;

  constructor(opts: WsWebSocketProviderOptions) {
    if (!opts.urlProvider && !opts.url) {
      throw new Error('Must provide either urlProvider or url');
    }
    this.#urlProvider = getComponent(opts.urlProvider, 'get', {
      default: () => opts.url!,
    });
    this.#headersProvider = getComponent(opts.headersProvider, 'get', {
      default: () => undefined,
    });
  }

  /**
   * Open (or reuse) the underlying `ws.WebSocket` and return it as `WebSocketLike`.
   *
   * Resolves once the socket is open. A cached socket is only reused while it
   * is open; otherwise a new one is created. Concurrent calls while a
   * connection is being established all share the same in-flight promise so
   * only one socket is ever created.
   *
   * @returns The open `WebSocketLike` connection.
   * @throws {Error} If the connection fails or closes before it opens. The next call
   * tries again.
   */
  async get(): Promise<WebSocketLike> {
    if (this.#ws?.readyState === WebSocketReadyState.OPEN) {
      return this.#ws as unknown as WebSocketLike;
    }

    this.#ws = null;

    if (!this.#pending) {
      this.#pending = (async () => {
        try {
          return await this.#createSocket();
        } finally {
          this.#pending = null;
        }
      })();
    }

    return this.#pending as Promise<WebSocketLike>;
  }

  async #createSocket(): Promise<WebSocket> {
    const [url, headersInit] = await Promise.all([
      this.#urlProvider(),
      this.#headersProvider(),
    ]);

    const headers = headersInit ? toHeadersRecord(headersInit) : undefined;
    const ws = new WebSocket(
      url as string | URL,
      headers ? { headers } : undefined,
    );

    ws.on('close', () => {
      if (this.#ws === ws) this.#ws = null;
    });

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        ws.off('error', onFailure);
        ws.off('close', onClose);
        resolve();
      };
      const onFailure = (err: Error) => {
        ws.off('open', onOpen);
        ws.off('close', onClose);
        reject(err);
      };
      const onClose = () => {
        ws.off('open', onOpen);
        ws.off('error', onFailure);
        reject(new Error('WebSocket closed before it opened'));
      };

      ws.once('open', onOpen);
      ws.once('error', onFailure);
      ws.once('close', onClose);
    });

    this.#ws = ws;
    return ws;
  }
}
