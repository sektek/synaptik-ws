import { Event } from '@sektek/synaptik';

import { EventExtractorFn } from './types/index.js';

/**
 * Parses a JSON text-frame `MessageEvent` into an `Event`.
 *
 * Binary payloads (`ArrayBuffer`, `ArrayBufferView`) are rejected; provide a
 * custom `eventExtractor` in `WebSocketGatewayOptions` for binary protocols.
 *
 * @param messageEvent - The raw WebSocket message event.
 * @returns The parsed event.
 */
export const defaultEventExtractor: EventExtractorFn = (
  messageEvent: MessageEvent,
): Event => {
  if (
    messageEvent.data instanceof ArrayBuffer ||
    ArrayBuffer.isView(messageEvent.data)
  ) {
    throw new Error(
      'DefaultEventExtractor does not support binary payloads. Provide a custom eventExtractor for binary protocols.',
    );
  }
  return JSON.parse(String(messageEvent.data)) as Event;
};
