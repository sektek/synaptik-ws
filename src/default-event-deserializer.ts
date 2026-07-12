import { Event } from '@sektek/synaptik';

import { EventDeserializerFn } from './types/index.js';

/**
 * Parses a JSON text-frame `MessageEvent` into an `Event`.
 *
 * Binary payloads (`ArrayBuffer`, `ArrayBufferView`) are rejected; provide a
 * custom `eventDeserializer` in `WebSocketGatewayOptions` for binary protocols.
 *
 * @param messageEvent - The raw WebSocket message event.
 * @returns The parsed event.
 */
export const defaultEventDeserializer: EventDeserializerFn = (
  messageEvent: MessageEvent,
): Event => {
  if (
    messageEvent.data instanceof ArrayBuffer ||
    ArrayBuffer.isView(messageEvent.data)
  ) {
    throw new Error(
      'DefaultEventDeserializer does not support binary payloads. Provide a custom eventDeserializer for binary protocols.',
    );
  }
  const parsed: unknown = JSON.parse(String(messageEvent.data));

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).type !== 'string' ||
    typeof (parsed as Record<string, unknown>).id !== 'string' ||
    !Object.hasOwn(parsed as Record<string, unknown>, 'data')
  ) {
    throw new Error(
      'Invalid event: expected { type: string, id: string, data: ... }',
    );
  }

  return parsed as Event;
};
