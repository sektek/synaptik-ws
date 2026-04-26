import { Event } from '@sektek/synaptik';

import { EventExtractorFn } from './types/index.js';

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
