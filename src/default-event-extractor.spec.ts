import { expect } from 'chai';

import { defaultEventExtractor } from './default-event-extractor.js';

const makeMessageEvent = (data: unknown) => ({ data }) as MessageEvent;

describe('defaultEventExtractor', function () {
  it('parses a JSON string payload into an Event', function () {
    const event = { type: 'test', id: '1', data: {} };
    const result = defaultEventExtractor(
      makeMessageEvent(JSON.stringify(event)),
    );
    expect(result).to.deep.equal(event);
  });

  it('throws for payloads missing required Event fields', function () {
    expect(() =>
      defaultEventExtractor(makeMessageEvent(JSON.stringify({ type: 'test' }))),
    ).to.throw('Invalid event');
  });

  it('throws for non-object payloads', function () {
    expect(() =>
      defaultEventExtractor(makeMessageEvent('"just a string"')),
    ).to.throw('Invalid event');
  });

  it('throws for ArrayBuffer payloads', function () {
    expect(() =>
      defaultEventExtractor(makeMessageEvent(new ArrayBuffer(4))),
    ).to.throw('binary');
  });

  it('throws for ArrayBufferView payloads', function () {
    expect(() =>
      defaultEventExtractor(makeMessageEvent(new Uint8Array(4))),
    ).to.throw('binary');
  });
});
