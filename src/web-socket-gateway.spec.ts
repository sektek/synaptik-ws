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

import { CONNECTION_CLOSED } from './events.js';
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
      .calledTwice;
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

  it('start() cleans up the old listener when called again without stop()', async function () {
    const wsFirst = makeFakeWs();
    const wsSecond = makeFakeWs();
    let callCount = 0;
    const provider = () => (callCount++ === 0 ? wsFirst : wsSecond);

    const gateway = new WebSocketGateway({
      webSocketProvider: provider,
      handler: sinon.stub().resolves(),
    });

    await gateway.start();
    await gateway.start();

    expect(wsFirst.removeEventListener as sinon.SinonStub).to.have.been
      .calledTwice;
    expect(wsSecond.addEventListener as sinon.SinonStub).to.have.been
      .calledTwice;
  });

  it('stop() called before provider resolves abandons the in-flight start()', async function () {
    let resolveProvider!: (ws: WebSocketLike) => void;
    const pendingProvider = new Promise<WebSocketLike>(
      resolve => (resolveProvider = resolve),
    );

    const gateway = new WebSocketGateway({
      webSocketProvider: () => pendingProvider,
      handler: sinon.stub().resolves(),
    });

    const starting = gateway.start();
    await gateway.stop();
    const ws = makeFakeWs();
    resolveProvider(ws);
    await starting;

    expect(ws.addEventListener as sinon.SinonStub).not.to.have.been.called;
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

  it('emits EVENT_ERROR when a Buffer[] payload exceeds maxPayloadSize', async function () {
    const ws = makeFakeWs();
    const onError = sinon.stub();

    const gateway = new WebSocketGateway({
      webSocketProvider: () => ws,
      handler: sinon.stub().resolves(),
      maxPayloadSize: 4,
    });
    gateway.on(EVENT_ERROR, onError);
    await gateway.start();

    const messageHandler = (ws.addEventListener as sinon.SinonStub)
      .getCalls()
      .find(c => c.args[0] === 'message')?.args[1] as (e: MessageEvent) => void;

    const chunks = [Buffer.from('hello'), Buffer.from('world')];
    await messageHandler({ data: chunks } as unknown as MessageEvent);

    expect(onError.calledOnce).to.be.true;
    expect((onError.firstCall.args[0] as Error).message).to.match(
      /maxPayloadSize/,
    );
  });

  it('emits EVENT_ERROR for unknown payload types', async function () {
    const ws = makeFakeWs();
    const onError = sinon.stub();

    const gateway = new WebSocketGateway({
      webSocketProvider: () => ws,
      handler: sinon.stub().resolves(),
      maxPayloadSize: 100,
    });
    gateway.on(EVENT_ERROR, onError);
    await gateway.start();

    const messageHandler = (ws.addEventListener as sinon.SinonStub)
      .getCalls()
      .find(c => c.args[0] === 'message')?.args[1] as (e: MessageEvent) => void;

    await messageHandler({ data: 42 } as unknown as MessageEvent);

    expect(onError.calledOnce).to.be.true;
    expect((onError.firstCall.args[0] as Error).message).to.match(
      /maxPayloadSize/,
    );
  });

  it('emits CONNECTION_CLOSED when the socket closes', async function () {
    const result = await startServer();
    wss = result.wss;
    const port = result.port;

    const onClosed = sinon.stub();

    const connectionDone = new Promise<void>(resolve => {
      wss!.once('connection', async serverWs => {
        const gateway = new WebSocketGateway({
          webSocketProvider: () => serverWs as unknown as WebSocket,
          handler: sinon.stub().resolves(),
        });
        gateway.on(CONNECTION_CLOSED, onClosed);
        await gateway.start();
        resolve();
      });
    });

    clientWs = await connectClient(port);
    await connectionDone;

    clientWs.close();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(onClosed.calledOnce).to.be.true;
  });

  it('does not emit CONNECTION_CLOSED after stop()', async function () {
    const result = await startServer();
    wss = result.wss;
    const port = result.port;

    const onClosed = sinon.stub();

    const connectionDone = new Promise<void>(resolve => {
      wss!.once('connection', async serverWs => {
        const gateway = new WebSocketGateway({
          webSocketProvider: () => serverWs as unknown as WebSocket,
          handler: sinon.stub().resolves(),
        });
        gateway.on(CONNECTION_CLOSED, onClosed);
        await gateway.start();
        await gateway.stop();
        resolve();
      });
    });

    clientWs = await connectClient(port);
    await connectionDone;

    clientWs.close();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(onClosed.called).to.be.false;
  });

  it('auto-restarts after socket close when autoRestart is true', async function () {
    const ws1 = makeFakeWs();
    const ws2 = makeFakeWs();
    let callCount = 0;
    const provider = () => (callCount++ === 0 ? ws1 : ws2);

    const gateway = new WebSocketGateway({
      webSocketProvider: provider,
      handler: sinon.stub().resolves(),
      autoRestart: true,
    });

    await gateway.start();

    const closeHandler = (ws1.addEventListener as sinon.SinonStub)
      .getCalls()
      .find(c => c.args[0] === 'close')?.args[1] as () => void;

    closeHandler();
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(ws2.addEventListener as sinon.SinonStub).to.have.been.calledWith(
      'message',
      sinon.match.func,
    );

    await gateway.stop();
  });

  it('does not auto-restart after stop()', async function () {
    const ws1 = makeFakeWs();
    const ws2 = makeFakeWs();
    let callCount = 0;
    const provider = () => (callCount++ === 0 ? ws1 : ws2);

    const gateway = new WebSocketGateway({
      webSocketProvider: provider,
      handler: sinon.stub().resolves(),
      autoRestart: true,
    });

    await gateway.start();
    await gateway.stop();

    const closeHandler = (ws1.addEventListener as sinon.SinonStub)
      .getCalls()
      .find(c => c.args[0] === 'close')?.args[1] as (() => void) | undefined;

    closeHandler?.();
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(ws2.addEventListener as sinon.SinonStub).not.to.have.been.called;
  });
});
