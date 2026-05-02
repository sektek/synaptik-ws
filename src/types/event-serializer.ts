import { Component } from '@sektek/utility-belt';
import { Event } from '@sektek/synaptik';

type BufferLike = string | ArrayBufferLike | Blob | ArrayBufferView;

/**
 * Serializes an event to a form suitable for `WebSocket.send`.
 *
 * @template T Event type to serialize.
 */
export type EventSerializerFn<T extends Event = Event> = (
  event: T,
) => PromiseLike<BufferLike> | BufferLike;

/**
 * Object form of `EventSerializerFn`.
 *
 * @template T Event type to serialize.
 */
export interface EventSerializer<T extends Event = Event> {
  serialize: EventSerializerFn<T>;
}

/**
 * Accepts either an `EventSerializer` object or a bare `EventSerializerFn`.
 *
 * @template T Event type to serialize.
 */
export type EventSerializerComponent<T extends Event = Event> = Component<
  EventSerializerFn<T>,
  'serialize'
>;
