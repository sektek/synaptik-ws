import { Component } from '@sektek/utility-belt';
import { Event } from '@sektek/synaptik';

type BufferLike = string | ArrayBufferLike | Blob | ArrayBufferView;

export type EventSerializerFn<T extends Event = Event> = (
  event: T,
) => PromiseLike<BufferLike> | BufferLike;
export interface EventSerializer<T extends Event = Event> {
  serialize: EventSerializerFn<T>;
}
export type EventSerializerComponent<T extends Event = Event> = Component<
  EventSerializerFn<T>,
  'serialize'
>;
