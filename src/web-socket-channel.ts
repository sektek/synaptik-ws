import {
  AbstractEventService,
  EVENT_DELIVERED,
  EVENT_ERROR,
  EVENT_RECEIVED,
  Event,
  EventChannelEvents,
  EventServiceOptions,
} from '@sektek/synaptik';
import { Component, getComponent } from '@sektek/utility-belt';

import {
  EventSerializerComponent,
  EventSerializerFn,
  WebSocketProviderComponent,
  WebSocketProviderFn,
} from './types/index.js';

export type WebSocketChannelFn<T extends Event = Event> = (
  event: T,
) => Promise<void>;

export type WebSocketChannelComponent<T extends Event = Event> = Component<
  WebSocketChannel<T>,
  'send'
>;

export type WebSocketChannelOptions<T extends Event = Event> =
  EventServiceOptions & {
    eventSerializer?: EventSerializerComponent<T>;
    webSocketProvider: WebSocketProviderComponent;
  };

export class WebSocketChannel<T extends Event = Event>
  extends AbstractEventService
  implements EventEmittingService<EventChannelEvents<T>>
{
  #eventSerializer: EventSerializerFn<T>;
  #webSocketProvider: WebSocketProviderFn;

  constructor(opts: WebSocketChannelOptions<T>) {
    super(opts);
    this.#webSocketProvider = getComponent(opts.webSocketProvider, 'get');
    this.#eventSerializer = getComponent(opts.eventSerializer, 'serialize', {
      name: 'eventSerializer',
      default: JSON.stringify as EventSerializerFn<T>,
    });
  }

  async send(event: T): Promise<void> {
    this.emit(EVENT_RECEIVED, event);

    try {
      const ws = await this.#webSocketProvider(event);
      const data = await this.#eventSerializer(event);
      ws.send(data);
      this.emit(EVENT_DELIVERED, event);
    } catch (err) {
      this.emit(EVENT_ERROR, err, event);
      throw err;
    }
  }
}
