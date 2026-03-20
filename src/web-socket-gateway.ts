import {
  AbstractEventService,
  EVENT_ERROR,
  EVENT_PROCESSED,
  EVENT_RECEIVED,
  Event,
  EventEndpointComponent,
  EventHandlerFn,
  EventServiceOptions,
  getEventHandlerComponent,
} from '@sektek/synaptik';
import { getComponent } from '@sektek/utility-belt';

import {
  EventExtractorComponent,
  EventExtractorFn,
  WebSocketProviderComponent,
  WebSocketProviderFn,
} from './types/index.js';

export type WebSocketGatewayOptions<T extends Event = Event> =
  EventServiceOptions & {
    eventExtractor: EventExtractorComponent<T>;
    handler: EventEndpointComponent<T>;
    webSocketProvider: WebSocketProviderComponent;
  };

export class WebSocketGateway<
  T extends Event = Event,
> extends AbstractEventService {
  #handler: EventHandlerFn<T>;
  #eventExtractor: EventExtractorFn<T>;
  #webSocketProvider: WebSocketProviderFn;

  constructor(opts: WebSocketGatewayOptions) {
    super(opts);
    this.#webSocketProvider = getComponent(opts.webSocketProvider, 'get');
    this.#eventExtractor = getComponent(opts.eventExtractor, 'extract');
    this.#handler = getEventHandlerComponent(opts.handler);
  }

  async start(): Promise<void> {
    const ws = await this.#webSocketProvider();
    ws.addEventListener('message', this.#messageHandler);
  }

  async stop(): Promise<void> {
    const ws = await this.#webSocketProvider();
    ws.removeEventListener('message', this.#messageHandler);
  }

  async #handleMessage(messageEvent: MessageEvent): Promise<void> {
    try {
      const event = await this.#eventExtractor(messageEvent);
      this.emit(EVENT_RECEIVED, event);
      this.#handler(event);
      this.emit(EVENT_PROCESSED, event);
    } catch (err) {
      this.emit(EVENT_ERROR, err);
    }
  }

  get #messageHandler(): (messageEvent: MessageEvent) => Promise<void> {
    return this.#handleMessage.bind(this);
  }
}
