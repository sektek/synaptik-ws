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
import {
  EventEmittingService,
  ProviderComponent,
  ProviderFn,
  SERVICE_STARTED,
  SERVICE_START_ERROR,
  SERVICE_STOPPED,
  SERVICE_STOP_ERROR,
  ServiceEvents,
  getComponent,
  toError,
} from '@sektek/utility-belt';

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

/** Default delay before an automatic restart, in milliseconds (restart immediately). */
export const DEFAULT_RESTART_DELAY = 0;

/**
 * Events emitted by `WebSocketGateway`.
 *
 * - `event:received`, `event:processed`, `event:error`: the message pipeline
 *   events from `EventHandlerEvents`.
 * - `connection:closed`: the socket closed while the gateway was started.
 * - `service:started`: `start()` attached the message listener.
 * - `service:startError`: `start()` failed. Carries an `Error`.
 * - `service:stopped`: `stop()` detached the message listener.
 * - `service:stopError`: `stop()` failed. Carries an `Error`.
 *
 * @template T The event type produced by the deserializer.
 */
export type WebSocketGatewayEvents<T extends Event = Event> =
  EventHandlerEvents<T> &
    ServiceEvents & {
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
    /**
     * Milliseconds to wait before each automatic restart. Calling `stop()`
     * cancels a pending delay. Ignored when `restartDelayProvider` is set.
     *
     * Setting either this or `restartDelayProvider` also makes a restart that
     * fails get reported with `EVENT_ERROR` and retried after the next delay.
     * Without either, a failed restart is reported and the gateway stays
     * stopped.
     * Defaults to `DEFAULT_RESTART_DELAY` (restart immediately).
     */
    restartDelay?: number;
    /**
     * Resolves the milliseconds to wait before each automatic restart. It is
     * given the `attempt`: the number of consecutive failed restarts so far
     * (`0` for the first restart after a close), which resets once a
     * connection opens. Takes precedence over `restartDelay`.
     */
    restartDelayProvider?: ProviderComponent<number, number>;
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
 * Emits the `Service` lifecycle events; see `start()` and `stop()`. A failure
 * emits only the matching `service:*Error` event, which carries an `Error`; a
 * non-`Error` thrown value is wrapped, with the original as its `cause`.
 * Listener exceptions are not isolated: they propagate to the caller of
 * `start()` or `stop()`.
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
  #restartAttempt = 0;
  #restartDelayProvider: ProviderFn<number, number>;
  #retryFailedRestarts: boolean;
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
    this.#restartDelayProvider = getComponent(
      opts.restartDelayProvider,
      'get',
      {
        name: 'restartDelayProvider',
        default: () => opts.restartDelay ?? DEFAULT_RESTART_DELAY,
      },
    );
    this.#retryFailedRestarts =
      opts.restartDelay !== undefined ||
      opts.restartDelayProvider !== undefined;
    this.#closeHandler = this.#handleClose.bind(this);
    this.#messageHandler = this.#handleMessage.bind(this);
  }

  /**
   * Resolve and cache the WebSocket, then attach the message listener.
   *
   * Safe to call multiple times: detaches from any previously cached socket
   * before attaching to the new one.
   *
   * Emits `service:started` once the message listener is attached. If `stop()`
   * is called before the provider resolves, the in-flight `start()` is
   * abandoned: it attaches no listener and emits nothing.
   *
   * If `start()` fails, it emits only `service:startError`, with the failure
   * as an `Error` (a non-`Error` thrown value is wrapped, with the original as
   * `cause`), and rethrows the original thrown value.
   *
   * Automatic restarts call `start()`, so each emits `service:started`. A
   * restart whose `start()` fails emits `service:startError` in addition to
   * `event:error`.
   */
  async start(): Promise<void> {
    try {
      this.#started = true;
      this.#ws?.removeEventListener('message', this.#messageHandler);
      this.#ws?.removeEventListener('close', this.#closeHandler);
      this.#ws = null;
      const gen = ++this.#generation;
      const ws = await this.#webSocketProvider();
      if (gen !== this.#generation) return;
      this.#restartAttempt = 0;
      this.#ws = ws;
      this.#ws.addEventListener('message', this.#messageHandler);
      this.#ws.addEventListener('close', this.#closeHandler);
    } catch (err) {
      this.emit(SERVICE_START_ERROR, toError(err));
      throw err;
    }

    this.emit(SERVICE_STARTED);
  }

  /**
   * Detach the message listener from the cached WebSocket and release it.
   *
   * Invalidates any `start()` call that is still awaiting the provider, and
   * suppresses any pending auto-restart triggered by a socket close.
   *
   * Emits `service:stopped` once the message listener is detached. If `stop()`
   * fails, it emits only `service:stopError`, with the failure as an `Error`
   * (a non-`Error` thrown value is wrapped, with the original as `cause`), and
   * rethrows the original thrown value.
   */
  async stop(): Promise<void> {
    try {
      this.#started = false;
      ++this.#generation;
      this.#ws?.removeEventListener('message', this.#messageHandler);
      this.#ws?.removeEventListener('close', this.#closeHandler);
      this.#ws = null;
    } catch (err) {
      this.emit(SERVICE_STOP_ERROR, toError(err));
      throw err;
    }

    this.emit(SERVICE_STOPPED);
  }

  #handleClose(): void {
    const ws = this.#ws;
    this.#ws = null;
    ws?.removeEventListener('message', this.#messageHandler);
    ws?.removeEventListener('close', this.#closeHandler);
    this.emit(CONNECTION_CLOSED);
    if (this.#started && this.#autoRestart) {
      this.#restart();
    }
  }

  async #restart(): Promise<void> {
    for (;;) {
      const gen = this.#generation;

      try {
        const delayMs = await this.#restartDelayProvider(this.#restartAttempt);

        if (delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        if (gen !== this.#generation) return;

        await this.start();
        return;
      } catch (err) {
        this.emit(EVENT_ERROR, err, undefined);

        const canRetry =
          this.#retryFailedRestarts &&
          this.#started &&
          gen + 1 === this.#generation;

        if (!canRetry) return;

        this.#restartAttempt++;
      }
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
