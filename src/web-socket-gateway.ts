import {
  AbstractEventComponent,
  EVENT_ERROR,
  EVENT_PROCESSED,
  EVENT_RECEIVED,
  Event,
  EventComponentOptions,
  EventEndpointComponent,
  EventHandlerEvents,
  EventHandlerFn,
  getEventHandlerComponent,
} from '@sektek/synaptik';
import { EventEmittingService, getComponent } from '@sektek/utility-belt';

import {
  EventExtractorComponent,
  EventExtractorFn,
  WebSocketLike,
  WebSocketProviderComponent,
  WebSocketProviderFn,
} from './types/index.js';
import { defaultEventExtractor } from './default-event-extractor.js';

/** Default maximum inbound message size (100 KB). */
export const DEFAULT_MAX_PAYLOAD_SIZE = 100 * 1024;

/**
 * Options for constructing a `WebSocketGateway`.
 *
 * @template T The event type produced by the extractor.
 */
export type WebSocketGatewayOptions<T extends Event = Event> =
  EventComponentOptions & {
    /** Extracts events from raw WebSocket messages. Defaults to `defaultEventExtractor`. */
    eventExtractor?: EventExtractorComponent<T>;
    /** Downstream handler that processes each extracted event. */
    handler: EventEndpointComponent<T>;
    /**
     * Maximum inbound message size in bytes before extraction is attempted.
     * Messages exceeding this limit are rejected with an `EVENT_ERROR`.
     * Defaults to `DEFAULT_MAX_PAYLOAD_SIZE` (100 KB).
     */
    maxPayloadSize?: number;
    /** Resolves the `WebSocketLike` to listen on. */
    webSocketProvider: WebSocketProviderComponent;
  };

/**
 * Listens on a WebSocket connection and dispatches each incoming message to a
 * handler after extracting it into a typed event.
 *
 * Call `start()` to attach the message listener and `stop()` to detach it.
 * Emits `EVENT_RECEIVED`, `EVENT_PROCESSED`, and `EVENT_ERROR` lifecycle events.
 *
 * @template T The event type produced by the extractor.
 */
export class WebSocketGateway<T extends Event = Event>
  extends AbstractEventComponent
  implements EventEmittingService<EventHandlerEvents<T>>
{
  #handler: EventHandlerFn<T>;
  #eventExtractor: EventExtractorFn<T>;
  #maxPayloadSize: number;
  #webSocketProvider: WebSocketProviderFn;
  #messageHandler: (messageEvent: MessageEvent) => Promise<void>;
  #ws: WebSocketLike | null = null;

  constructor(opts: WebSocketGatewayOptions<T>) {
    super(opts);
    this.#webSocketProvider = getComponent(opts.webSocketProvider, 'get');
    this.#eventExtractor = getComponent(opts.eventExtractor, 'extract', {
      name: 'eventExtractor',
      default: defaultEventExtractor as EventExtractorFn<T>,
    });
    this.#handler = getEventHandlerComponent(opts.handler);
    this.#maxPayloadSize = opts.maxPayloadSize ?? DEFAULT_MAX_PAYLOAD_SIZE;
    this.#messageHandler = this.#handleMessage.bind(this);
  }

  /** Resolve and cache the WebSocket, then attach the message listener. */
  async start(): Promise<void> {
    this.#ws = await this.#webSocketProvider();
    this.#ws.addEventListener('message', this.#messageHandler);
  }

  /** Detach the message listener from the cached WebSocket and release it. */
  async stop(): Promise<void> {
    this.#ws?.removeEventListener('message', this.#messageHandler);
    this.#ws = null;
  }

  async #handleMessage(messageEvent: MessageEvent): Promise<void> {
    let event: T | undefined;
    try {
      const payloadSize = this.#measurePayload(messageEvent.data);

      if (payloadSize > this.#maxPayloadSize) {
        throw new Error(
          `Message payload (${payloadSize} bytes) exceeds maxPayloadSize limit of ${this.#maxPayloadSize} bytes`,
        );
      }

      event = await this.#eventExtractor(messageEvent);
      this.emit(EVENT_RECEIVED, event);
      await this.#handler(event);
      this.emit(EVENT_PROCESSED, event);
    } catch (err) {
      this.emit(EVENT_ERROR, err, event);
    }
  }

  #measurePayload(data: MessageEvent['data']): number {
    if (typeof data === 'string') return data.length;
    if (data instanceof ArrayBuffer) return data.byteLength;
    if (ArrayBuffer.isView(data)) return data.byteLength;
    if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size;
    return 0;
  }
}
