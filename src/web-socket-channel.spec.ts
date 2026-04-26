import {
  EVENT_DELIVERED,
  EVENT_ERROR,
  EVENT_RECEIVED,
  Event,
} from '@sektek/synaptik';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

use(chaiAsPromised);
use(sinonChai);

import { WebSocketChannel } from './web-socket-channel.js';
import { WebSocketLike } from './types/index.js';

const makeEvent = (): Event => ({ type: 'test', id: '1' });

const makeFakeWs = (): WebSocketLike => ({
  send: sinon.stub(),
  close: sinon.stub(),
  addEventListener: sinon.stub(),
  removeEventListener: sinon.stub(),
  readyState: 1,
});

describe('WebSocketChannel', function () {
  it('emits EVENT_RECEIVED then EVENT_DELIVERED on send', async function () {
    const ws = makeFakeWs();
    const channel = new WebSocketChannel({
      webSocketProvider: () => ws,
    });
    const received = sinon.stub();
    const delivered = sinon.stub();
    channel.on(EVENT_RECEIVED, received);
    channel.on(EVENT_DELIVERED, delivered);

    const event = makeEvent();
    await channel.send(event);

    expect(received.calledOnceWith(event)).to.be.true;
    expect(delivered.calledOnceWith(event)).to.be.true;
    expect((ws.send as sinon.SinonStub).calledOnce).to.be.true;
  });

  it('calls ws.send with the serialized event', async function () {
    const ws = makeFakeWs();
    const event = makeEvent();
    const channel = new WebSocketChannel({
      webSocketProvider: () => ws,
    });

    await channel.send(event);

    expect((ws.send as sinon.SinonStub).calledWith(JSON.stringify(event))).to.be
      .true;
  });

  it('uses a custom eventSerializer when provided', async function () {
    const ws = makeFakeWs();
    const serializer = sinon.stub().returns('custom');
    const channel = new WebSocketChannel({
      webSocketProvider: () => ws,
      eventSerializer: serializer,
    });

    await channel.send(makeEvent());

    expect(serializer.calledOnce).to.be.true;
    expect((ws.send as sinon.SinonStub).calledWith('custom')).to.be.true;
  });

  it('emits EVENT_ERROR and rethrows when ws.send throws', async function () {
    const ws = makeFakeWs();
    const error = new Error('send failed');
    (ws.send as sinon.SinonStub).throws(error);

    const channel = new WebSocketChannel({
      webSocketProvider: () => ws,
    });
    const errorStub = sinon.stub();
    channel.on(EVENT_ERROR, errorStub);

    await expect(channel.send(makeEvent())).to.be.rejectedWith('send failed');
    expect(errorStub.calledWith(error)).to.be.true;
  });
});
