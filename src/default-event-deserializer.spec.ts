import { expect } from 'chai';

import { defaultEventDeserializer } from './default-event-deserializer.js';

const makeMessageEvent = (data: unknown) => ({ data }) as MessageEvent;

describe('defaultEventDeserializer', function () {
  it('parses a JSON string payload into an Event', function () {
    const event = { type: 'test', id: '1', data: {} };
    const result = defaultEventDeserializer(
      makeMessageEvent(JSON.stringify(event)),
    );
    expect(result).to.deep.equal(event);
  });

  it('throws for payloads missing required Event fields', function () {
    expect(() =>
      defaultEventDeserializer(
        makeMessageEvent(JSON.stringify({ type: 'test' })),
      ),
    ).to.throw('Invalid event');
  });

  it('throws for non-object payloads', function () {
    expect(() =>
      defaultEventDeserializer(makeMessageEvent('"just a string"')),
    ).to.throw('Invalid event');
  });

  it('throws for ArrayBuffer payloads', function () {
    expect(() =>
      defaultEventDeserializer(makeMessageEvent(new ArrayBuffer(4))),
    ).to.throw('binary');
  });

  it('throws for ArrayBufferView payloads', function () {
    expect(() =>
      defaultEventDeserializer(makeMessageEvent(new Uint8Array(4))),
    ).to.throw('binary');
  });
});
