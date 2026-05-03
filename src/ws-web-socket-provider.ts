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
 * Lazily opens a single connection on the first `get()` call and nulls it on
 * close, so the next `get()` reconnects automatically. Both `urlProvider` and
 * `headersProvider` are called fresh on every new connection so session URLs
 * and auth tokens are always current.
 */
export class WsWebSocketProvider implements WebSocketProvider {
  #ws: WebSocket | null = null;
  #pending: Promise<WebSocket> | null = null;
  #urlProvider: UrlProviderFn<void>;
  #headersProvider: HeadersProviderFn | undefined;

  constructor(opts: WsWebSocketProviderOptions) {
    if (!opts.urlProvider && !opts.url) {
      throw new Error('Must provide either urlProvider or url');
    }
    this.#urlProvider = getComponent(opts.urlProvider, 'get', {
      default: () => opts.url!,
    });
    this.#headersProvider = opts.headersProvider
      ? getComponent(opts.headersProvider, 'get')
      : undefined;
  }

  /**
   * Open (or reuse) the underlying `ws.WebSocket` and return it as `WebSocketLike`.
   *
   * Concurrent calls while a connection is being established all share the same
   * in-flight promise so only one socket is ever created.
   *
   * @returns The active `WebSocketLike` connection.
   */
  async get(): Promise<WebSocketLike> {
    if (this.#ws) return this.#ws as unknown as WebSocketLike;

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

    return this.#pending as Promise<WebSocketLike>;
  }

  async #createSocket(): Promise<WebSocket> {
    const [url, headersInit] = await Promise.all([
      this.#urlProvider(),
      this.#headersProvider ? this.#headersProvider() : undefined,
    ]);

    const headers = headersInit ? toHeadersRecord(headersInit) : undefined;
    const ws = new WebSocket(
      url as string | URL,
      headers ? { headers } : undefined,
    );

    ws.on('close', () => {
      this.#ws = null;
      this.#pending = null;
    });

    this.#ws = ws;
    return ws;
  }
}
