export type NativeWebSocketProviderOptions = {
  url: string | URL;
  protocol?: string | string[];
};

export class NativeWebSocketProvider {
  #ws: WebSocket | null = null;
  #url: string | URL;
  #protocol: string | string[] | undefined;

  constructor(opts: NativeWebSocketProviderOptions) {
    this.#url = opts.url;
    this.#protocol = opts.protocol;
  }

  get(): WebSocket {
    this.#ws ??= new WebSocket(this.#url, this.#protocol);
    this.#ws.addEventListener('close', () => {
      this.#ws = null;
    });
    return this.#ws;
  }
}
