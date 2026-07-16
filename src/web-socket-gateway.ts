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
  EventDeserializerComponent,
  EventDeserializerFn,
  WebSocketLike,
  WebSocketProviderComponent,
  WebSocketProviderFn,
} from './types/index.js';
import { CONNECTION_CLOSED } from './events.js';
import { defaultEventDeserializer } from './default-event-deserializer.js';

/** Default maximum inbound message size (100 KB). */
export const DEFAULT_MAX_PAYLOAD_SIZE = 100 * 1024;

/**
 * Events emitted by `WebSocketGateway`.
 *
 * @template T The event type produced by the deserializer.
 */
export type WebSocketGatewayEvents<T extends Event = Event> =
  EventHandlerEvents<T> & {
    /** Emitted when the underlying socket closes while the gateway is started. */
    [CONNECTION_CLOSED]: () => void;
  };

/**
 * Options for constructing a `WebSocketGateway`.
 *
 * @template T The event type produced by the deserializer.
 */
export type WebSocketGatewayOptions<T extends Event = Event> =
  EventComponentOptions & {
    /**
     * When `true`, the gateway automatically calls `start()` again after the
     * socket closes, using the `webSocketProvider` to obtain a fresh connection.
     * Has no effect if `stop()` has been called explicitly.
     * Defaults to `false`.
     */
    autoRestart?: boolean;
    /** Deserializes events from raw WebSocket messages. Defaults to `defaultEventDeserializer`. */
    eventDeserializer?: EventDeserializerComponent<T>;
    /** Downstream handler that processes each deserialized event. */
    handler: EventEndpointComponent<T>;
    /**
     * Maximum inbound message size in bytes before deserialization is attempted.
     * Messages exceeding this limit are rejected with an `EVENT_ERROR`.
     * Defaults to `DEFAULT_MAX_PAYLOAD_SIZE` (100 KB).
     */
    maxPayloadSize?: number;
    /** Resolves the `WebSocketLike` to listen on. */
    webSocketProvider: WebSocketProviderComponent;
  };

/**
 * Listens on a WebSocket connection and dispatches each incoming message to a
 * handler after deserializing it into a typed event.
 *
 * Call `start()` to attach the message listener and `stop()` to detach it.
 * Emits `EVENT_RECEIVED`, `EVENT_PROCESSED`, and `EVENT_ERROR` lifecycle events.
 *
 * @template T The event type produced by the deserializer.
 */
export class WebSocketGateway<T extends Event = Event>
  extends AbstractEventComponent
  implements EventEmittingService<WebSocketGatewayEvents<T>>
{
  #autoRestart: boolean;
  #handler: EventHandlerFn<T>;
  #eventDeserializer: EventDeserializerFn<T>;
  #generation = 0;
  #maxPayloadSize: number;
  #started = false;
  #webSocketProvider: WebSocketProviderFn;
  #closeHandler: () => void;
  #messageHandler: (messageEvent: MessageEvent) => Promise<void>;
  #ws: WebSocketLike | null = null;

  constructor(opts: WebSocketGatewayOptions<T>) {
    super(opts);
    this.#webSocketProvider = getComponent(opts.webSocketProvider, 'get');
    this.#eventDeserializer = getComponent(
      opts.eventDeserializer,
      'deserialize',
      {
        name: 'eventDeserializer',
        default: defaultEventDeserializer as EventDeserializerFn<T>,
      },
    );
    this.#handler = getEventHandlerComponent(opts.handler);
    this.#autoRestart = opts.autoRestart ?? false;
    this.#maxPayloadSize = opts.maxPayloadSize ?? DEFAULT_MAX_PAYLOAD_SIZE;
    this.#closeHandler = this.#handleClose.bind(this);
    this.#messageHandler = this.#handleMessage.bind(this);
  }

  /**
   * Resolve and cache the WebSocket, then attach the message listener.
   *
   * Safe to call multiple times: detaches from any previously cached socket
   * before attaching to the new one. If `stop()` is called before the provider
   * resolves, the in-flight `start()` is abandoned and no listener is attached.
   */
  async start(): Promise<void> {
    this.#started = true;
    this.#ws?.removeEventListener('message', this.#messageHandler);
    this.#ws?.removeEventListener('close', this.#closeHandler);
    this.#ws = null;
    const gen = ++this.#generation;
    const ws = await this.#webSocketProvider();
    if (gen !== this.#generation) return;
    this.#ws = ws;
    this.#ws.addEventListener('message', this.#messageHandler);
    this.#ws.addEventListener('close', this.#closeHandler);
  }

  /**
   * Detach the message listener from the cached WebSocket and release it.
   *
   * Invalidates any `start()` call that is still awaiting the provider, and
   * suppresses any pending auto-restart triggered by a socket close.
   */
  async stop(): Promise<void> {
    this.#started = false;
    ++this.#generation;
    this.#ws?.removeEventListener('message', this.#messageHandler);
    this.#ws?.removeEventListener('close', this.#closeHandler);
    this.#ws = null;
  }

  #handleClose(): void {
    const ws = this.#ws;
    this.#ws = null;
    ws?.removeEventListener('message', this.#messageHandler);
    ws?.removeEventListener('close', this.#closeHandler);
    this.emit(CONNECTION_CLOSED);
    if (this.#started && this.#autoRestart) {
      (async () => {
        try {
          await this.start();
        } catch (err) {
          this.emit(EVENT_ERROR, err, undefined);
        }
      })();
    }
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

      event = await this.#eventDeserializer(messageEvent);
      this.emit(EVENT_RECEIVED, event);
      await this.#handler(event);
      this.emit(EVENT_PROCESSED, event);
    } catch (err) {
      this.emit(EVENT_ERROR, err, event);
    }
  }

  #measurePayload(data: MessageEvent['data']): number {
    if (typeof data === 'string') return Buffer.byteLength(data, 'utf8');
    if (data instanceof ArrayBuffer) return data.byteLength;
    if (ArrayBuffer.isView(data)) return data.byteLength;
    if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size;
    if (Array.isArray(data))
      return (data as ArrayBufferView[]).reduce(
        (sum, chunk) => sum + chunk.byteLength,
        0,
      );
    return Infinity;
  }
}
