import { UrlProviderComponent } from '@sektek/utility-belt';

/**
 * Base options shared by all `WebSocketProvider` implementations.
 *
 * Exactly one of `url` or `urlProvider` must be supplied. `urlProvider` takes
 * precedence when both are present; `url` is used as the static fallback.
 * The provider is called fresh before every new connection so session URLs
 * and signed tokens embedded in the URL are always current on reconnect.
 */
export type WebSocketProviderOptions = {
  /**
   * Static URL to connect to. Ignored if `urlProvider` is also supplied.
   */
  url?: string | URL;
  /**
   * Provider that resolves the WebSocket URL before each new connection.
   * Takes precedence over `url`.
   */
  urlProvider?: UrlProviderComponent<void>;
};
