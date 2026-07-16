import { IncomingMessage } from 'node:http';

import { WebSocket, WebSocketServer } from 'ws';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { WsWebSocketProvider } from './ws-web-socket-provider.js';

use(chaiAsPromised);

const startServer = (): Promise<{ wss: WebSocketServer; port: number }> =>
  new Promise(resolve => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const addr = wss.address() as { port: number };
      resolve({ wss, port: addr.port });
    });
  });

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('WsWebSocketProvider', function () {
  let wss: WebSocketServer;

  afterEach(function (done) {
    for (const client of wss?.clients ?? []) client.terminate();
    wss?.close(done);
  });

  it('get() returns a connected WebSocketLike', async function () {
    const result = await startServer();
    wss = result.wss;

    const provider = new WsWebSocketProvider({
      url: `ws://localhost:${result.port}`,
    });

    const ws = await provider.get();
    await new Promise(resolve => wss.once('connection', resolve));

    expect(ws.readyState).to.be.oneOf([0, 1]);
  });

  it('get() returns the same instance on repeated calls', async function () {
    const result = await startServer();
    wss = result.wss;

    const provider = new WsWebSocketProvider({
      url: `ws://localhost:${result.port}`,
    });

    const ws1 = await provider.get();
    const ws2 = await provider.get();
    await new Promise(resolve => wss.once('connection', resolve));

    expect(ws1).to.equal(ws2);
  });

  it('get() returns a new socket after the previous one closes', async function () {
    const result = await startServer();
    wss = result.wss;

    const provider = new WsWebSocketProvider({
      url: `ws://localhost:${result.port}`,
    });

    const ws1 = (await provider.get()) as unknown as WebSocket;
    await new Promise<void>(resolve => ws1.once('open', resolve));

    ws1.close();
    await wait(50);

    const ws2 = (await provider.get()) as unknown as WebSocket;
    await new Promise(resolve => wss.once('connection', resolve));

    expect(ws2).to.not.equal(ws1);
  });

  it('calls urlProvider fresh on each new connection', async function () {
    const result = await startServer();
    wss = result.wss;

    let callCount = 0;
    const provider = new WsWebSocketProvider({
      urlProvider: () => {
        callCount++;
        return `ws://localhost:${result.port}`;
      },
    });

    const ws1 = (await provider.get()) as unknown as WebSocket;
    await new Promise<void>(resolve => ws1.once('open', resolve));
    expect(callCount).to.equal(1);

    ws1.close();
    await wait(50);

    await provider.get();
    await new Promise(resolve => wss.once('connection', resolve));

    expect(callCount).to.equal(2);
  });

  it('sends headersProvider headers on the WebSocket upgrade request', async function () {
    const result = await startServer();
    wss = result.wss;

    const provider = new WsWebSocketProvider({
      url: `ws://localhost:${result.port}`,
      headersProvider: () => ({ authorization: 'Bearer test-token' }),
    });

    const requestPromise = new Promise<IncomingMessage>(resolve => {
      wss.once('connection', (_, req) => resolve(req));
    });

    await provider.get();
    const req = await requestPromise;

    expect(req.headers.authorization).to.equal('Bearer test-token');
  });

  it('fetches fresh headers on reconnect', async function () {
    const result = await startServer();
    wss = result.wss;

    let callCount = 0;
    const provider = new WsWebSocketProvider({
      url: `ws://localhost:${result.port}`,
      headersProvider: () => ({ authorization: `Bearer token-${++callCount}` }),
    });

    const firstReq = new Promise<IncomingMessage>(resolve =>
      wss.once('connection', (_, req) => resolve(req)),
    );
    const ws1 = (await provider.get()) as unknown as WebSocket;
    await new Promise<void>(resolve => ws1.once('open', resolve));
    expect((await firstReq).headers.authorization).to.equal('Bearer token-1');

    ws1.close();
    await wait(50);

    const secondReq = new Promise<IncomingMessage>(resolve =>
      wss.once('connection', (_, req) => resolve(req)),
    );
    await provider.get();
    expect((await secondReq).headers.authorization).to.equal('Bearer token-2');
  });
});
