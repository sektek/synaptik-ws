import {
  EVENT_DELIVERED,
  EVENT_ERROR,
  EVENT_RECEIVED,
  Event,
} from '@sektek/synaptik';
import { WebSocket, WebSocketServer } from 'ws';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import { WebSocketChannel } from './web-socket-channel.js';
import { WebSocketLike } from './types/index.js';

use(chaiAsPromised);
use(sinonChai);

const makeEvent = (): Event => ({ type: 'test', id: '1', data: {} });

const startServer = (): Promise<{ wss: WebSocketServer; port: number }> =>
  new Promise(resolve => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const addr = wss.address() as { port: number };
      resolve({ wss, port: addr.port });
    });
  });

const connectClient = (port: number): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const client = new WebSocket(`ws://localhost:${port}`);
    client.once('open', () => resolve(client));
    client.once('error', reject);
  });

describe('WebSocketChannel', function () {
  let wss: WebSocketServer | undefined;
  let clientWs: WebSocket | undefined;

  afterEach(function (done) {
    clientWs?.close();
    clientWs = undefined;
    if (wss) {
      const server = wss;
      wss = undefined;
      server.close(done);
    } else {
      done();
    }
  });

  it('emits EVENT_RECEIVED then EVENT_DELIVERED on send', async function () {
    const result = await startServer();
    wss = result.wss;

    const connectionReady = new Promise<WebSocket>(resolve => {
      wss!.once('connection', ws => resolve(ws));
    });

    clientWs = await connectClient(result.port);
    const serverWs = await connectionReady;

    const channel = new WebSocketChannel({
      webSocketProvider: () => serverWs as unknown as WebSocketLike,
    });
    const received = sinon.stub();
    const delivered = sinon.stub();
    channel.on(EVENT_RECEIVED, received);
    channel.on(EVENT_DELIVERED, delivered);

    const event = makeEvent();
    const messageReceived = new Promise<void>(resolve => {
      clientWs!.once('message', () => resolve());
    });

    await channel.send(event);
    await messageReceived;

    expect(received.calledOnceWith(event)).to.be.true;
    expect(received.calledBefore(delivered)).to.be.true;
    expect(delivered.calledOnceWith(event)).to.be.true;
  });

  it('delivers the serialized event to the client', async function () {
    const result = await startServer();
    wss = result.wss;

    const connectionReady = new Promise<WebSocket>(resolve => {
      wss!.once('connection', ws => resolve(ws));
    });

    clientWs = await connectClient(result.port);
    const serverWs = await connectionReady;

    const channel = new WebSocketChannel({
      webSocketProvider: () => serverWs as unknown as WebSocketLike,
    });
    const event = makeEvent();
    const messageReceived = new Promise<string>(resolve => {
      clientWs!.once('message', data => resolve(data.toString()));
    });

    await channel.send(event);

    expect(await messageReceived).to.equal(JSON.stringify(event));
  });

  it('uses a custom eventSerializer when provided', async function () {
    const result = await startServer();
    wss = result.wss;

    const connectionReady = new Promise<WebSocket>(resolve => {
      wss!.once('connection', ws => resolve(ws));
    });

    clientWs = await connectClient(result.port);
    const serverWs = await connectionReady;

    const serializer = sinon.stub().returns('custom');
    const channel = new WebSocketChannel({
      webSocketProvider: () => serverWs as unknown as WebSocketLike,
      eventSerializer: serializer,
    });
    const messageReceived = new Promise<string>(resolve => {
      clientWs!.once('message', data => resolve(data.toString()));
    });

    await channel.send(makeEvent());

    expect(serializer.calledOnce).to.be.true;
    expect(await messageReceived).to.equal('custom');
  });

  it('emits EVENT_ERROR and rethrows when the serializer throws', async function () {
    const result = await startServer();
    wss = result.wss;

    const connectionReady = new Promise<WebSocket>(resolve => {
      wss!.once('connection', ws => resolve(ws));
    });

    clientWs = await connectClient(result.port);
    const serverWs = await connectionReady;

    const error = new Error('serialization failed');
    const channel = new WebSocketChannel({
      webSocketProvider: () => serverWs as unknown as WebSocketLike,
      eventSerializer: () => {
        throw error;
      },
    });
    const errorStub = sinon.stub();
    channel.on(EVENT_ERROR, errorStub);

    await expect(channel.send(makeEvent())).to.be.rejectedWith(
      'serialization failed',
    );
    expect(errorStub.calledWith(error)).to.be.true;
  });
});
