import { WebSocket } from 'ws';

import { WebSocketLike } from './types/index.js';

type WsWebSocketProviderOptions = {
  url: string;
};

export class WsWebSocketProvider {
  #ws: WebSocket | null = null;
  #url: string;

  constructor(opts: WsWebSocketProviderOptions) {
    this.#url = opts.url;
  }

  get(): WebSocketLike {
    if (!this.#ws) {
      this.#ws = new WebSocket(this.#url);
      this.#ws.on('close', () => {
        this.#ws = null;
      });
    }
    return this.#ws as unknown as WebSocketLike;
  }
}
