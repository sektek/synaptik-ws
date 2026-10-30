import { expect, use } from 'chai';
import { WebSocketServer } from 'ws';
import chaiAsPromised from 'chai-as-promised';

import { NativeWebSocketProvider } from './native-web-socket-provider.js';
import { WebSocketChannel } from './web-socket-channel.js';
import { WebSocketReadyState } from './types/index.js';

use(chaiAsPromised);

const startServer = (): Promise<{ wss: WebSocketServer; port: number }> =>
  new Promise(resolve => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const addr = wss.address() as { port: number };
      resolve({ wss, port: addr.port });
    });
  });

const closedPort = async (): Promise<number> => {
  const { wss, port } = await startServer();
  await new Promise(resolve => wss.close(resolve));
  return port;
};

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

    const ws = await provider.get();

    expect(ws.readyState).to.equal(WebSocketReadyState.OPEN);
  });

  it('get() returns the same instance on repeated calls', async function () {
    const result = await startServer();
    wss = result.wss;

    const provider = new NativeWebSocketProvider({
      url: `ws://localhost:${result.port}`,
    });

    const ws1 = await provider.get();
    const ws2 = await provider.get();

    expect(ws1).to.equal(ws2);
  });

  it('get() returns a new socket after the previous one closes', async function () {
    const result = await startServer();
    wss = result.wss;

    const provider = new NativeWebSocketProvider({
      url: `ws://localhost:${result.port}`,
    });

    const ws1 = await provider.get();

    ws1.close();
    await wait(50);

    const ws2 = await provider.get();

    expect(ws2).to.not.equal(ws1);
  });

  it('calls urlProvider fresh on each new connection', async function () {
    const result = await startServer();
    wss = result.wss;

    let callCount = 0;
    const provider = new NativeWebSocketProvider({
      urlProvider: () => {
        callCount++;
        return `ws://localhost:${result.port}`;
      },
    });

    const ws1 = await provider.get();
    expect(callCount).to.equal(1);

    ws1.close();
    await wait(50);

    await provider.get();

    expect(callCount).to.equal(2);
  });

  it('shares one socket between concurrent get() calls', async function () {
    const result = await startServer();
    wss = result.wss;

    const provider = new NativeWebSocketProvider({
      url: `ws://localhost:${result.port}`,
    });

    const [ws1, ws2] = await Promise.all([provider.get(), provider.get()]);

    expect(ws1).to.equal(ws2);
    expect(wss.clients.size).to.equal(1);
  });

  it('lets a channel send immediately after the first get()', async function () {
    const result = await startServer();
    wss = result.wss;

    const received = new Promise<string>(resolve =>
      wss.once('connection', ws =>
        ws.once('message', data => resolve(data.toString())),
      ),
    );
    const provider = new NativeWebSocketProvider({
      url: `ws://localhost:${result.port}`,
    });
    const channel = new WebSocketChannel({ webSocketProvider: provider });

    await provider.get();
    await channel.send({ type: 'test', id: '1', data: {} });

    expect(JSON.parse(await received)).to.include({ id: '1' });
  });

  it('rejects get() when the connection is refused and retries on the next call', async function () {
    const port = await closedPort();
    let url = `ws://localhost:${port}`;
    const provider = new NativeWebSocketProvider({ urlProvider: () => url });

    await expect(provider.get()).to.be.rejected;

    const result = await startServer();
    wss = result.wss;
    url = `ws://localhost:${result.port}`;

    expect((await provider.get()).readyState).to.equal(
      WebSocketReadyState.OPEN,
    );
  });

  it('opens a new socket when the cached one is closing', async function () {
    const result = await startServer();
    wss = result.wss;

    const provider = new NativeWebSocketProvider({
      url: `ws://localhost:${result.port}`,
    });

    const ws1 = await provider.get();
    ws1.close();
    expect(ws1.readyState).to.equal(WebSocketReadyState.CLOSING);

    const ws2 = await provider.get();

    expect(ws2).to.not.equal(ws1);
    expect(ws2.readyState).to.equal(WebSocketReadyState.OPEN);
  });
});
