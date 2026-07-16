import { Provider, ProviderComponent, ProviderFn } from '@sektek/utility-belt';

import { WebSocketLike } from './web-socket-like.js';

/** Function that resolves a `WebSocketLike` instance, optionally given context `T`. */
export type WebSocketProviderFn<T = void> = ProviderFn<WebSocketLike, T>;

/** Object form of `WebSocketProviderFn`. */
export interface WebSocketProvider<T = void> extends Provider<
  WebSocketLike,
  T
> {}

/** Accepts either a `WebSocketProvider` object or a bare `WebSocketProviderFn`. */
export type WebSocketProviderComponent<T = void> = ProviderComponent<
  WebSocketLike,
  T
>;
