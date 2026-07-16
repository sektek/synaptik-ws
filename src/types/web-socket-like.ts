/** `readyState` values shared by browser `WebSocket` and `ws.WebSocket`. */
export const WebSocketReadyState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

/** Structural interface satisfied by both `WebSocket` (browser) and `ws.WebSocket` (Node). */
export interface WebSocketLike {
  /** Transmit data to the remote end. */
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;

  /** Initiate a close handshake. */
  close(code?: number, reason?: string): void;

  /** Register a listener for incoming messages. */
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void;

  /** Register a listener for the connection close event. */
  addEventListener(type: 'close', listener: () => void): void;

  /** Remove a previously registered message listener. */
  removeEventListener(
    type: 'message',
    listener: (ev: MessageEvent) => void,
  ): void;

  /** Remove a previously registered close listener. */
  removeEventListener(type: 'close', listener: () => void): void;

  /** Current connection state. See {@link WebSocketReadyState} for named values. */
  readonly readyState: number;
}
