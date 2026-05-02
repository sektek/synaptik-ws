import {
  AbstractEventComponent,
  EVENT_DELIVERED,
  EVENT_ERROR,
  EVENT_RECEIVED,
  Event,
  EventChannelEvents,
  EventComponentOptions,
} from '@sektek/synaptik';
import {
  Component,
  EventEmittingService,
  getComponent,
} from '@sektek/utility-belt';

import {
  EventSerializerComponent,
  EventSerializerFn,
  WebSocketProviderComponent,
  WebSocketProviderFn,
} from './types/index.js';

/**
 * Function signature matching `WebSocketChannel.send`.
 *
 * @template T The event type this function accepts.
 */
export type WebSocketChannelFn<T extends Event = Event> = (
  event: T,
) => Promise<void>;

/**
 * Accepts either a `WebSocketChannel` instance or a bare `WebSocketChannelFn`.
 *
 * @template T The event type the channel handles.
 */
export type WebSocketChannelComponent<T extends Event = Event> = Component<
  WebSocketChannel<T>,
  'send'
>;

/**
 * Options for constructing a `WebSocketChannel`.
 *
 * @template T The event type this channel handles.
 */
export type WebSocketChannelOptions<T extends Event = Event> =
  EventComponentOptions & {
    /** Serializer applied before `ws.send`. Defaults to `JSON.stringify`. */
    eventSerializer?: EventSerializerComponent<T>;
    /** Resolves the target `WebSocketLike` at send time. */
    webSocketProvider: WebSocketProviderComponent;
  };

/**
 * Sends events over a WebSocket connection.
 *
 * Emits `EVENT_RECEIVED` before serialization, `EVENT_DELIVERED` after a
 * successful send, and `EVENT_ERROR` (re-throwing) on failure.
 *
 * @template T The event type this channel handles.
 */
export class WebSocketChannel<T extends Event = Event>
  extends AbstractEventComponent
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

  /**
   * Serialize and transmit `event` over the WebSocket.
   *
   * @param event - The event to send.
   */
  async send(event: T): Promise<void> {
    this.emit(EVENT_RECEIVED, event);

    try {
      const ws = await this.#webSocketProvider();
      const data = await this.#eventSerializer(event);
      ws.send(data);
      this.emit(EVENT_DELIVERED, event);
    } catch (err) {
      this.emit(EVENT_ERROR, err, event);
      throw err;
    }
  }
}
