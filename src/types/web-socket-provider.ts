import { Provider, ProviderComponent, ProviderFn } from '@sektek/utility-belt';

export type WebSocketProviderFn<T = unknown> = ProviderFn<WebSocket, T>;
export interface WebSocketProvider<T = unknown>
  extends Provider<WebSocket, T> {}
export type WebSocketProviderComponent<T = unknown> = ProviderComponent<
  WebSocket,
  T
>;
