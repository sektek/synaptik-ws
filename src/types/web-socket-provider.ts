import { Provider, ProviderComponent, ProviderFn } from '@sektek/utility-belt';

import { WebSocketLike } from './web-socket-like.js';

export type WebSocketProviderFn<T = void> = ProviderFn<WebSocketLike, T>;
export interface WebSocketProvider<T = void> extends Provider<
  WebSocketLike,
  T
> {}
export type WebSocketProviderComponent<T = void> = ProviderComponent<
  WebSocketLike,
  T
>;
