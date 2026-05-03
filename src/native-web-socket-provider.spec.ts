import { expect, use } from 'chai';
import { WebSocketServer } from 'ws';
import chaiAsPromised from 'chai-as-promised';

import { NativeWebSocketProvider } from './native-web-socket-provider.js';

use(chaiAsPromised);

const startServer = (): Promise<{ wss: WebSocketServer; port: number }> =>
  new Promise(resolve => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const addr = wss.address() as { port: number };
      resolve({ wss, port: addr.port });
    });
  });

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('NativeWebSocketProvider', function () {
  let wss: WebSocketServer;

  afterEach(function (done) {
    for (const client of wss?.clients ?? []) client.terminate();
    wss?.close(done);
  });

  it('get() returns a connected WebSocketLike', async function () {
    const result = await startServer();
    wss = result.wss;

    const provider = new NativeWebSocketProvider({
      url: `ws://localhost:${result.port}`,
    });

    provider.get();
    await new Promise(resolve => wss.once('connection', resolve));

    expect(provider.get().readyState).to.be.oneOf([0, 1]);
  });

  it('get() returns the same instance on repeated calls', async function () {
    const result = await startServer();
    wss = result.wss;

    const provider = new NativeWebSocketProvider({
      url: `ws://localhost:${result.port}`,
    });

    const ws1 = provider.get();
    const ws2 = provider.get();
    await new Promise(resolve => wss.once('connection', resolve));

    expect(ws1).to.equal(ws2);
  });

  it('get() returns a new socket after the previous one closes', async function () {
    const result = await startServer();
    wss = result.wss;

    const provider = new NativeWebSocketProvider({
      url: `ws://localhost:${result.port}`,
    });

    const ws1 = provider.get() as globalThis.WebSocket;
    await new Promise<void>(resolve =>
      ws1.addEventListener('open', () => resolve()),
    );

    ws1.close();
    await wait(50);

    const ws2 = provider.get();
    await new Promise(resolve => wss.once('connection', resolve));

    expect(ws2).to.not.equal(ws1);
  });
});
