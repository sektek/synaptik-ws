import {
  EVENT_ERROR,
  EVENT_PROCESSED,
  EVENT_RECEIVED,
  Event,
} from '@sektek/synaptik';
import { WebSocket, WebSocketServer } from 'ws';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import { WebSocketGateway } from './web-socket-gateway.js';
import { WebSocketLike } from './types/index.js';

use(chaiAsPromised);
use(sinonChai);

const makeEvent = (): Event => ({ type: 'ping', id: '1', data: {} });

const makeFakeWs = (): WebSocketLike => ({
  send: sinon.stub(),
  close: sinon.stub(),
  addEventListener:
    sinon.stub() as unknown as WebSocketLike['addEventListener'],
  removeEventListener:
    sinon.stub() as unknown as WebSocketLike['removeEventListener'],
  readyState: 1,
});

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

describe('WebSocketGateway', function () {
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

  it('dispatches incoming messages to the handler', async function () {
    const result = await startServer();
    wss = result.wss;
    const port = result.port;
    const handler = sinon.stub().resolves();

    wss.once('connection', serverWs => {
      const gateway = new WebSocketGateway({
        webSocketProvider: () => serverWs as unknown as WebSocket,
        handler,
      });
      gateway.start();
    });

    clientWs = await connectClient(port);
    clientWs.send(JSON.stringify(makeEvent()));

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(handler.calledOnce).to.be.true;
  });

  it('emits EVENT_RECEIVED and EVENT_PROCESSED around handler', async function () {
    const result = await startServer();
    wss = result.wss;
    const port = result.port;

    const received = sinon.stub();
    const processed = sinon.stub();
    const handler = sinon.stub().resolves();

    wss.once('connection', serverWs => {
      const gateway = new WebSocketGateway({
        webSocketProvider: () => serverWs as unknown as WebSocket,
        handler,
      });
      gateway.on(EVENT_RECEIVED, received);
      gateway.on(EVENT_PROCESSED, processed);
      gateway.start();
    });

    clientWs = await connectClient(port);
    clientWs.send(JSON.stringify(makeEvent()));

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(received.calledOnce).to.be.true;
    expect(processed.calledOnce).to.be.true;
  });

  it('emits EVENT_ERROR when the handler throws', async function () {
    const result = await startServer();
    wss = result.wss;
    const port = result.port;

    const error = new Error('handler failed');
    const handler = sinon.stub().rejects(error);
    const onError = sinon.stub();

    wss.once('connection', serverWs => {
      const gateway = new WebSocketGateway({
        webSocketProvider: () => serverWs as unknown as WebSocket,
        handler,
      });
      gateway.on(EVENT_ERROR, onError);
      gateway.start();
    });

    clientWs = await connectClient(port);
    clientWs.send(JSON.stringify(makeEvent()));

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(onError.calledOnce).to.be.true;
    expect(onError.firstCall.args[0]).to.equal(error);
  });

  it('stop() removes the listener from the socket resolved at start(), not from a new provider call', async function () {
    const wsAtStart = makeFakeWs();
    const wsAfterReconnect = makeFakeWs();
    let callCount = 0;
    const provider = () => (callCount++ === 0 ? wsAtStart : wsAfterReconnect);

    const gateway = new WebSocketGateway({
      webSocketProvider: provider,
      handler: sinon.stub().resolves(),
    });

    await gateway.start();
    await gateway.stop();

    expect(wsAtStart.removeEventListener as sinon.SinonStub).to.have.been
      .calledOnce;
    expect(wsAfterReconnect.removeEventListener as sinon.SinonStub).not.to.have
      .been.called;
  });

  it('stop() removes the listener so no further messages are dispatched', async function () {
    const result = await startServer();
    wss = result.wss;
    const port = result.port;

    const handler = sinon.stub().resolves();

    const connectionDone = new Promise<void>(resolve => {
      wss!.once('connection', async serverWs => {
        const gateway = new WebSocketGateway({
          webSocketProvider: () => serverWs as unknown as WebSocket,
          handler,
        });
        await gateway.start();
        await gateway.stop();
        resolve();
      });
    });
    clientWs = await connectClient(port);
    await connectionDone;

    clientWs.send(JSON.stringify(makeEvent()));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(handler.callCount).to.equal(0);
  });

  it('emits EVENT_ERROR when the message exceeds maxPayloadSize', async function () {
    const result = await startServer();
    wss = result.wss;
    const port = result.port;

    const onError = sinon.stub();

    wss.once('connection', serverWs => {
      const gateway = new WebSocketGateway({
        webSocketProvider: () => serverWs as unknown as WebSocket,
        handler: sinon.stub().resolves(),
        maxPayloadSize: 10,
      });
      gateway.on(EVENT_ERROR, onError);
      gateway.start();
    });

    clientWs = await connectClient(port);
    clientWs.send(JSON.stringify(makeEvent()));

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(onError.calledOnce).to.be.true;
    expect((onError.firstCall.args[0] as Error).message).to.match(
      /maxPayloadSize/,
    );
  });
});
