import {
  EVENT_ERROR,
  EVENT_PROCESSED,
  EVENT_RECEIVED,
  Event,
} from '@sektek/synaptik';
import {
  ProcessManager,
  SERVICE_STARTED,
  SERVICE_START_ERROR,
  SERVICE_STOPPED,
  SERVICE_STOP_ERROR,
  isStartable,
  isStoppable,
} from '@sektek/utility-belt';
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

  describe('lifecycle events', function () {
    it('is startable and stoppable', function () {
      const gateway = new WebSocketGateway({
        webSocketProvider: () => makeFakeWs(),
        handler: sinon.stub().resolves(),
      });

      expect(isStartable(gateway)).to.be.true;
      expect(isStoppable(gateway)).to.be.true;
    });

    it('emits SERVICE_STARTED then SERVICE_STOPPED once each', async function () {
      const onStarted = sinon.stub();
      const onStopped = sinon.stub();
      const gateway = new WebSocketGateway({
        webSocketProvider: () => makeFakeWs(),
        handler: sinon.stub().resolves(),
      });
      gateway.on(SERVICE_STARTED, onStarted).on(SERVICE_STOPPED, onStopped);

      await gateway.start();
      expect(onStarted).to.have.been.calledOnce;
      expect(onStopped).not.to.have.been.called;

      await gateway.stop();
      expect(onStarted).to.have.been.calledOnce;
      expect(onStopped).to.have.been.calledOnce;
      expect(onStarted).to.have.been.calledBefore(onStopped);
    });

    it('emits SERVICE_START_ERROR and rejects with the same error when start() fails', async function () {
      const failure = new Error('refused');
      const onStarted = sinon.stub();
      const onStartError = sinon.stub();
      const gateway = new WebSocketGateway({
        webSocketProvider: () => Promise.reject(failure),
        handler: sinon.stub().resolves(),
      });
      gateway
        .on(SERVICE_STARTED, onStarted)
        .on(SERVICE_START_ERROR, onStartError);

      await expect(gateway.start()).to.be.rejectedWith(failure);

      expect(onStartError).to.have.been.calledOnceWithExactly(failure);
      expect(onStarted).not.to.have.been.called;
    });

    it('wraps a non-Error start() failure in the event and rethrows the original', async function () {
      const onStartError = sinon.stub();
      const gateway = new WebSocketGateway({
        webSocketProvider: () => Promise.reject('refused'),
        handler: sinon.stub().resolves(),
      });
      gateway.on(SERVICE_START_ERROR, onStartError);

      let thrown: unknown;
      try {
        await gateway.start();
      } catch (err) {
        thrown = err;
      }

      expect(thrown).to.equal('refused');
      expect(onStartError).to.have.been.calledOnce;
      const emitted = onStartError.firstCall.args[0] as Error;
      expect(emitted).to.be.instanceOf(Error);
      expect(emitted.message).to.equal('refused');
      expect(emitted.cause).to.equal('refused');
    });

    it('emits SERVICE_STOP_ERROR and rejects with the same error when stop() fails', async function () {
      const failure = new Error('detach failed');
      const ws = makeFakeWs();
      const onStopped = sinon.stub();
      const onStopError = sinon.stub();
      const gateway = new WebSocketGateway({
        webSocketProvider: () => ws,
        handler: sinon.stub().resolves(),
      });
      gateway
        .on(SERVICE_STOPPED, onStopped)
        .on(SERVICE_STOP_ERROR, onStopError);
      await gateway.start();
      (ws.removeEventListener as sinon.SinonStub).throws(failure);

      await expect(gateway.stop()).to.be.rejectedWith(failure);

      expect(onStopError).to.have.been.calledOnceWithExactly(failure);
      expect(onStopped).not.to.have.been.called;

      (ws.removeEventListener as sinon.SinonStub).reset();
      await gateway.stop();
    });

    it('wraps a non-Error stop() failure in the event and rethrows the original', async function () {
      const ws = makeFakeWs();
      const onStopError = sinon.stub();
      const gateway = new WebSocketGateway({
        webSocketProvider: () => ws,
        handler: sinon.stub().resolves(),
      });
      gateway.on(SERVICE_STOP_ERROR, onStopError);
      await gateway.start();
      (ws.removeEventListener as sinon.SinonStub).callsFake(() => {
        throw 'detach failed';
      });

      let thrown: unknown;
      try {
        await gateway.stop();
      } catch (err) {
        thrown = err;
      }

      expect(thrown).to.equal('detach failed');
      const emitted = onStopError.firstCall.args[0] as Error;
      expect(emitted).to.be.instanceOf(Error);
      expect(emitted.cause).to.equal('detach failed');

      (ws.removeEventListener as sinon.SinonStub).reset();
      await gateway.stop();
    });

    it('emits nothing from a start() abandoned by stop()', async function () {
      let release!: (ws: WebSocketLike) => void;
      const onStarted = sinon.stub();
      const gateway = new WebSocketGateway({
        webSocketProvider: () =>
          new Promise<WebSocketLike>(resolve => {
            release = resolve;
          }),
        handler: sinon.stub().resolves(),
      });
      gateway.on(SERVICE_STARTED, onStarted);

      const starting = gateway.start();
      await gateway.stop();
      release(makeFakeWs());
      await starting;

      expect(onStarted).not.to.have.been.called;
    });

    it('is managed by a ProcessManager', async function () {
      const onStarted = sinon.stub();
      const onStopped = sinon.stub();
      const gateway = new WebSocketGateway({
        webSocketProvider: () => makeFakeWs(),
        handler: sinon.stub().resolves(),
      });
      gateway.on(SERVICE_STARTED, onStarted).on(SERVICE_STOPPED, onStopped);
      const manager = new ProcessManager({});
      manager.add(gateway);

      await manager.start();
      expect(onStarted).to.have.been.calledOnce;

      await manager.stop();
      expect(onStopped).to.have.been.calledOnce;
    });
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

  it('emits EVENT_ERROR when an ArrayBufferView (Buffer) payload exceeds maxPayloadSize', async function () {
    const result = await startServer();
    wss = result.wss;
    const onError = sinon.stub();

    const connectionDone = new Promise<void>(resolve => {
      wss!.once('connection', async serverWs => {
        const gateway = new WebSocketGateway({
          webSocketProvider: () => serverWs as unknown as WebSocket,
          handler: sinon.stub().resolves(),
          maxPayloadSize: 4,
        });
        gateway.on(EVENT_ERROR, onError);
        await gateway.start();
        resolve();
      });
    });

    clientWs = await connectClient(result.port);
    await connectionDone;

    clientWs.send(Buffer.alloc(5));
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(onError.calledOnce).to.be.true;
    expect((onError.firstCall.args[0] as Error).message).to.match(
      /maxPayloadSize/,
    );
  });

  it('emits EVENT_ERROR when an ArrayBuffer payload exceeds maxPayloadSize', async function () {
    const result = await startServer();
    wss = result.wss;
    const onError = sinon.stub();

    const connectionDone = new Promise<void>(resolve => {
      wss!.once('connection', async serverWs => {
        (serverWs as WebSocket).binaryType = 'arraybuffer';
        const gateway = new WebSocketGateway({
          webSocketProvider: () => serverWs as unknown as WebSocket,
          handler: sinon.stub().resolves(),
          maxPayloadSize: 4,
        });
        gateway.on(EVENT_ERROR, onError);
        await gateway.start();
        resolve();
      });
    });

    clientWs = await connectClient(result.port);
    await connectionDone;

    clientWs.send(Buffer.alloc(5));
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(onError.calledOnce).to.be.true;
    expect((onError.firstCall.args[0] as Error).message).to.match(
      /maxPayloadSize/,
    );
  });

  it('emits EVENT_ERROR when a Buffer[] payload exceeds maxPayloadSize', async function () {
    const result = await startServer();
    wss = result.wss;
    const onError = sinon.stub();

    const connectionDone = new Promise<void>(resolve => {
      wss!.once('connection', async serverWs => {
        (serverWs as WebSocket).binaryType = 'fragments';
        const gateway = new WebSocketGateway({
          webSocketProvider: () => serverWs as unknown as WebSocket,
          handler: sinon.stub().resolves(),
          maxPayloadSize: 4,
        });
        gateway.on(EVENT_ERROR, onError);
        await gateway.start();
        resolve();
      });
    });

    clientWs = await connectClient(result.port);
    await connectionDone;

    clientWs.send(Buffer.alloc(5));
    await new Promise(resolve => setTimeout(resolve, 50));

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

  it('emits EVENT_ERROR when a Blob payload exceeds maxPayloadSize', async function () {
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

    await messageHandler({
      data: new Blob(['hello']),
    } as unknown as MessageEvent);

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

  describe('restartDelay', function () {
    let clock: sinon.SinonFakeTimers;

    const closeHandlerOf = (ws: WebSocketLike): (() => void) =>
      (ws.addEventListener as sinon.SinonStub)
        .getCalls()
        .reverse()
        .find(c => c.args[0] === 'close')?.args[1] as () => void;

    class ScriptedProvider {
      calls = 0;
      readonly #script: Array<WebSocketLike | Error>;

      constructor(...script: Array<WebSocketLike | Error>) {
        this.#script = script;
      }

      get handler(): () => Promise<WebSocketLike> {
        return this.fetch.bind(this);
      }

      async fetch(): Promise<WebSocketLike> {
        const next = this.#script[this.calls++] ?? makeFakeWs();

        if (next instanceof Error) throw next;

        return next;
      }
    }

    beforeEach(function () {
      clock = sinon.useFakeTimers();
    });

    afterEach(function () {
      clock.restore();
    });

    it('waits a numeric restartDelay before restarting', async function () {
      const ws1 = makeFakeWs();
      const provider = new ScriptedProvider(ws1);

      const gateway = new WebSocketGateway({
        webSocketProvider: provider.handler,
        handler: sinon.stub().resolves(),
        autoRestart: true,
        restartDelay: 1000,
      });

      await gateway.start();
      closeHandlerOf(ws1)();

      await clock.tickAsync(999);
      expect(provider.calls).to.equal(1);

      await clock.tickAsync(1);
      expect(provider.calls).to.equal(2);

      await gateway.stop();
    });

    it('passes an increasing attempt to a restartDelayProvider and resets it after a connection opens', async function () {
      const ws1 = makeFakeWs();
      const ws2 = makeFakeWs();
      const refused = new Error('refused');
      const provider = new ScriptedProvider(ws1, refused, refused, ws2);
      const attempts: number[] = [];
      const restartDelayProvider = (attempt: number): number => {
        attempts.push(attempt);
        return 10;
      };
      const onError = sinon.stub();

      const gateway = new WebSocketGateway({
        webSocketProvider: provider.handler,
        handler: sinon.stub().resolves(),
        autoRestart: true,
        restartDelayProvider,
      });
      gateway.on(EVENT_ERROR, onError);

      await gateway.start();
      closeHandlerOf(ws1)();
      await clock.tickAsync(100);

      expect(attempts).to.deep.equal([0, 1, 2]);
      expect(provider.calls).to.equal(4);
      expect(onError).to.have.been.calledTwice;

      closeHandlerOf(ws2)();
      await clock.tickAsync(100);

      expect(attempts[3]).to.equal(0);
      expect(provider.calls).to.equal(5);

      await gateway.stop();
    });

    it('accepts an asynchronous restartDelayProvider', async function () {
      const ws1 = makeFakeWs();
      const provider = new ScriptedProvider(ws1);

      const gateway = new WebSocketGateway({
        webSocketProvider: provider.handler,
        handler: sinon.stub().resolves(),
        autoRestart: true,
        restartDelayProvider: async () => 500,
      });

      await gateway.start();
      closeHandlerOf(ws1)();

      await clock.tickAsync(499);
      expect(provider.calls).to.equal(1);

      await clock.tickAsync(1);
      expect(provider.calls).to.equal(2);

      await gateway.stop();
    });

    it('prefers restartDelayProvider over restartDelay', async function () {
      const ws1 = makeFakeWs();
      const provider = new ScriptedProvider(ws1);

      const gateway = new WebSocketGateway({
        webSocketProvider: provider.handler,
        handler: sinon.stub().resolves(),
        autoRestart: true,
        restartDelay: 5000,
        restartDelayProvider: () => 100,
      });

      await gateway.start();
      closeHandlerOf(ws1)();

      await clock.tickAsync(100);
      expect(provider.calls).to.equal(2);

      await gateway.stop();
    });

    it('does not restart when stop() is called during the delay', async function () {
      const ws1 = makeFakeWs();
      const provider = new ScriptedProvider(ws1);

      const gateway = new WebSocketGateway({
        webSocketProvider: provider.handler,
        handler: sinon.stub().resolves(),
        autoRestart: true,
        restartDelay: 1000,
      });

      await gateway.start();
      closeHandlerOf(ws1)();

      await clock.tickAsync(500);
      await gateway.stop();
      await clock.tickAsync(5000);

      expect(provider.calls).to.equal(1);
    });

    it('restarts immediately when restartDelay is not set', async function () {
      const ws1 = makeFakeWs();
      const provider = new ScriptedProvider(ws1);

      const gateway = new WebSocketGateway({
        webSocketProvider: provider.handler,
        handler: sinon.stub().resolves(),
        autoRestart: true,
      });

      await gateway.start();
      closeHandlerOf(ws1)();
      await clock.tickAsync(0);

      expect(provider.calls).to.equal(2);

      await gateway.stop();
    });

    it('does not retry a failed restart when restartDelay is not set', async function () {
      const ws1 = makeFakeWs();
      const refused = new Error('refused');
      const provider = new ScriptedProvider(ws1, refused, refused, refused);
      const onError = sinon.stub();

      const gateway = new WebSocketGateway({
        webSocketProvider: provider.handler,
        handler: sinon.stub().resolves(),
        autoRestart: true,
      });
      gateway.on(EVENT_ERROR, onError);

      await gateway.start();
      closeHandlerOf(ws1)();
      await clock.tickAsync(1000);

      expect(provider.calls).to.equal(2);
      expect(onError).to.have.been.calledOnce;

      await gateway.stop();
    });
  });
});
