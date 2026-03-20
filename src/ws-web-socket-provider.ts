import { WebSocket } from 'ws';

type WebSocketProviderOptions = {
  url: string;
};

export class WsWebSocketProvider {
  #ws: WebSocket | null = null;
  #url: string;

  constructor(opts: WebSocketProviderOptions) {
    this.#url = opts.url;
  }

  get(): WebSocket {
    this.#ws ??= new WebSocket(this.#url);
    this.#ws.on('close', () => {
      this.#ws = null;
    });
    return this.#ws;
  }
}
