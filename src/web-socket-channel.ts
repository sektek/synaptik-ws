import {
  AbstractEventService,
  Event,
  EventServiceOptions,
} from '@sektek/synaptik';
import { getComponent } from '@sektek/utility-belt';

import {
  EventSerializerComponent,
  EventSerializerFn,
  WebSocketProviderComponent,
  WebSocketProviderFn,
} from './types/index.js';

export type WebSocketChannelOptions<T extends Event = Event> =
  EventServiceOptions & {
    eventSerializer?: EventSerializerComponent<T>;
    webSocketProvider: WebSocketProviderComponent;
  };

export class WebSocketChannel<
  T extends Event = Event,
> extends AbstractEventService {
  #eventSerializer: EventSerializerFn<T>;
  #webSocketProvider: WebSocketProviderFn;

  constructor(opts: WebSocketChannelOptions<T>) {
    super(opts);
    this.#webSocketProvider = getComponent(opts.webSocketProvider, 'get');
    this.#eventSerializer = getComponent(opts.eventSerializer, 'serialize', {
      name: 'eventSerializer',
      default: JSON.stringify,
    });
  }

  async send(event: T): Promise<void> {
    const ws = await this.#webSocketProvider(event);
    const data = await this.#eventSerializer(event);
    ws.send(data);
  }
}
