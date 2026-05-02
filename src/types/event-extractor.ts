import { Component } from '@sektek/utility-belt';
import { Event } from '@sektek/synaptik';

/**
 * Extracts a typed event from a WebSocket `MessageEvent`.
 *
 * @template T Event type to extract.
 */
export type EventExtractorFn<T extends Event = Event> = (
  messageEvent: MessageEvent,
) => PromiseLike<T> | T;

/**
 * Object form of `EventExtractorFn`.
 *
 * @template T Event type to extract.
 */
export interface EventExtractor<T extends Event = Event> {
  extract: EventExtractorFn<T>;
}

/**
 * Accepts either an `EventExtractor` object or a bare `EventExtractorFn`.
 *
 * @template T Event type to extract.
 */
export type EventExtractorComponent<T extends Event = Event> = Component<
  EventExtractorFn<T>,
  'extract'
>;
