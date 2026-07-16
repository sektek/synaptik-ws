import { Component } from '@sektek/utility-belt';
import { Event } from '@sektek/synaptik';

/**
 * Deserializes a typed event from a WebSocket `MessageEvent`.
 *
 * @template T Event type to deserialize.
 */
export type EventDeserializerFn<T extends Event = Event> = (
  messageEvent: MessageEvent,
) => PromiseLike<T> | T;

/**
 * Object form of `EventDeserializerFn`.
 *
 * @template T Event type to deserialize.
 */
export interface EventDeserializer<T extends Event = Event> {
  deserialize: EventDeserializerFn<T>;
}

/**
 * Accepts either an `EventDeserializer` object or a bare `EventDeserializerFn`.
 *
 * @template T Event type to deserialize.
 */
export type EventDeserializerComponent<T extends Event = Event> = Component<
  EventDeserializer<T>,
  'deserialize'
>;
