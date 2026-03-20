import { Provider, ProviderComponent, ProviderFn } from '@sektek/utility-belt';

export type WebSocketProviderFn<T = void> = ProviderFn<WebSocket, T>;
export interface WebSocketProvider<T = void> extends Provider<WebSocket, T> {}
export type WebSocketProviderComponent<T = void> = ProviderComponent<
  WebSocket,
  T
>;
