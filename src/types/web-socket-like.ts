export interface WebSocketLike {
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void;
  removeEventListener(
    type: 'message',
    listener: (ev: MessageEvent) => void,
  ): void;
  readonly readyState: number;
}
