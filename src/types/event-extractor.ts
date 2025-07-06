import { Component } from '@sektek/utility-belt';
import { Event } from '@sektek/synaptik';

export type EventExtractorFn<T extends Event = Event> = (
  messageEvent: MessageEvent,
) => PromiseLike<T> | T;
export interface EventExtractor<T extends Event = Event> {
  extract: EventExtractorFn<T>;
}
export type EventExtractorComponent<T extends Event = Event> = Component<
  EventExtractorFn<T>,
  'extract'
>;
