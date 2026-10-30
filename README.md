# Synaptik WebSocket

WebSocket transport primitives for
[`@sektek/synaptik`](https://github.com/sektek/synaptik), for browsers and
Node.js. A `WebSocketChannel` sends events out over a socket, and a
`WebSocketGateway` listens on a socket and hands each incoming message to any
Synaptik event endpoint.

- **`WebSocketChannel`** serializes an `Event` and sends it.
- **`WebSocketGateway`** receives messages, checks their size, deserializes them
  into events, and passes them to a handler.
- **Providers** open and reuse the socket, and reconnect after it closes:
  `NativeWebSocketProvider` (browser `WebSocket`) and `WsWebSocketProvider`
  (Node, built on [`ws`](https://github.com/websockets/ws)).

Everything is written against a small `WebSocketLike` interface, so the same
channel and gateway work with a browser socket, a `ws` socket, or a server-side
socket you were handed by something else. Upgrade routing for an Express server
lives in
[`@sektek/synaptik-express`](https://github.com/sektek/synaptik-express), not
here.

## Installation

```sh
npm install @sektek/synaptik-ws
```

The package is ESM only. Everything is exported from the package root, except
the Node-only `WsWebSocketProvider`, which has its own subpath so browser
bundles never pull in `ws`:

```ts
import { WebSocketChannel, WebSocketGateway } from '@sektek/synaptik-ws';
import { WsWebSocketProvider } from '@sektek/synaptik-ws/ws';
```

It builds on [`@sektek/synaptik`](https://github.com/sektek/synaptik) and
[`@sektek/utility-belt`](https://github.com/sektek/utility-belt), which supply
the `Event` type, the component pattern and the providers used throughout.

## Contents

- [Quick start](#quick-start)
- [Providers](#providers)
  - [`NativeWebSocketProvider`](#nativewebsocketprovider)
  - [`WsWebSocketProvider`](#wswebsocketprovider)
  - [Reconnecting](#reconnecting)
  - [Using an existing socket](#using-an-existing-socket)
- [`WebSocketChannel`](#websocketchannel)
- [`WebSocketGateway`](#websocketgateway)
  - [Limiting message size](#limiting-message-size)
  - [Reconnecting automatically](#reconnecting-automatically)
- [Serialization](#serialization)
- [Events](#events)
- [`WebSocketLike`](#websocketlike)
- [License](#license)

## Quick start

A Node client that sends events to a server and handles the events it sends
back:

```ts
import { Event, EventBuilder } from '@sektek/synaptik';
import { WebSocketChannel, WebSocketGateway } from '@sektek/synaptik-ws';
import { WsWebSocketProvider } from '@sektek/synaptik-ws/ws';

type ChatEvent = Event<{ text: string }>;

const provider = new WsWebSocketProvider({ url: 'wss://example.com/chat' });

const gateway = new WebSocketGateway<ChatEvent>({
  webSocketProvider: provider,
  handler: (event: ChatEvent) => {
    console.log(`received: ${event.data.text}`);
  },
});

const channel = new WebSocketChannel<ChatEvent>({
  webSocketProvider: provider,
});

await gateway.start();

await channel.send(
  await EventBuilder.with<ChatEvent>({ type: 'chat' }).create({ text: 'hi' }),
);
```

Both objects share one provider, so they share one socket.

## Providers

A provider resolves the `WebSocketLike` that a channel or gateway uses. The
`webSocketProvider` option takes a provider object (anything with a `get`
method) or a plain function, so you can supply your own. Both built-in providers
behave the same way:

- The socket is opened lazily, on the first `get()`, which resolves once the
  socket is open. If the connection fails or closes before it opens, `get()`
  rejects and the next `get()` tries again.
- Concurrent `get()` calls while a connection is being established share one
  socket.
- A socket is only reused while it is open. When it closes, it is forgotten, and
  the next `get()` opens a new one.
- The URL is resolved fresh for every connection, so a session URL or signed
  token is current after a reconnect.

Pass either a static `url` (a `string` or `URL`) or a `urlProvider`, a function
or an object with a `get` method that returns the URL. If both are given,
`urlProvider` wins. Passing neither throws.

```ts
const provider = new WsWebSocketProvider({
  urlProvider: async () =>
    `wss://example.com/chat?session=${await newSession()}`,
});
```

### `NativeWebSocketProvider`

Uses the browser's `WebSocket` (also available in recent versions of Node).
`protocol` negotiates one or more subprotocols:

```ts
import { NativeWebSocketProvider } from '@sektek/synaptik-ws';

const provider = new NativeWebSocketProvider({
  url: 'wss://example.com/chat',
  protocol: 'chat.v1',
});
```

The browser `WebSocket` API can't set request headers. For authentication,
put a token in the URL, using a `urlProvider` so it is refreshed on each
reconnect.

### `WsWebSocketProvider`

Uses the `ws` package, for Node.js. It adds `headersProvider`, a function or an
object with a `get` method returning headers for the upgrade request. It is
called again on every reconnect, so a short-lived token is always current:

```ts
import { WsWebSocketProvider } from '@sektek/synaptik-ws/ws';

const provider = new WsWebSocketProvider({
  url: 'wss://example.com/chat',
  headersProvider: async () => ({
    Authorization: `Bearer ${await getToken()}`,
  }),
});
```

Headers can be a plain object, a `Headers` instance or an array of pairs.

#### Socket errors

Neither the provider, the channel nor the gateway listens for the socket's
`error` event. With `ws`, an `error` event that nobody listens to is thrown as an
uncaught exception, which crashes the process. A failed connection, such as the
server being unreachable, is enough to trigger it. Listen for `error` on each
socket by wrapping the provider:

```ts
const inner = new WsWebSocketProvider({ url: 'wss://example.com/chat' });
const watched = new WeakSet<object>();

const provider = async () => {
  const socket = await inner.get();

  if (!watched.has(socket)) {
    watched.add(socket);
    (socket as WebSocket).addEventListener('error', () => {
      console.error('socket error');
    });
  }

  return socket;
};
```

Pass `provider` as the `webSocketProvider` of the channel and the gateway. The
browser `WebSocket` doesn't throw on unhandled errors, but it is still worth
listening for them.

### Reconnecting

Providers reconnect lazily: nothing happens when a socket closes, and the next
`get()` opens a new one. A `WebSocketChannel` asks its provider on every
`send()`, so it picks up the new socket by itself. A `WebSocketGateway` only
asks when it is started, so to keep listening after a disconnect, turn on
[`autoRestart`](#reconnecting-automatically).

### Using an existing socket

A `webSocketProvider` can be any function that returns a `WebSocketLike`. That
makes it easy to use a socket you didn't open, such as one a server accepted:

```ts
wss.on('connection', socket => {
  const channel = new WebSocketChannel({ webSocketProvider: () => socket });
  const gateway = new WebSocketGateway({
    webSocketProvider: () => socket,
    handler,
  });

  void gateway.start();
});
```

The provider is passed the event being sent as its argument, so one channel can
route to different sockets:

```ts
const channel = new WebSocketChannel<ChatEvent>({
  webSocketProvider: event => socketsByRoom.get(event.data.room),
});
```

## `WebSocketChannel`

`send(event)` serializes the event and writes it to the socket. It is an
`EventChannel`, so it can be used anywhere Synaptik accepts one, including as
the destination of a `FlowBuilder` pipeline or an `EventRouter`.

| Option              | Description                                                            |
| ------------------- | ---------------------------------------------------------------------- |
| `webSocketProvider` | Resolves the socket to send on. Receives the event. Required.          |
| `eventSerializer`   | Turns an event into data for the socket. Defaults to `JSON.stringify`. |

If anything fails, whether the provider, the serializer or the socket's
`send()`, `event:error` is emitted and the error is rethrown from `send()`.

```ts
channel.on('event:error', (error, event) => {
  console.error(`failed to send ${event.id}`, error);
});
```

`event:delivered` means the data was handed to the socket's `send()`. It does
not confirm that the other end received it.

## `WebSocketGateway`

A gateway listens on one socket. For each message it checks the size,
deserializes it into an event, and calls `handler`. The handler is any event
endpoint, so a channel, a processor or a `FlowBuilder` pipeline works as well as
a function:

```ts
import { FlowBuilder } from '@sektek/synaptik';

const flowBuilder = new FlowBuilder<ChatEvent>();

const gateway = new WebSocketGateway<ChatEvent>({
  webSocketProvider: provider,
  handler: await flowBuilder
    .filter(isAllowed)
    .process(enrich)
    .handle(store)
    .get(),
});
```

Call `start()` to resolve the socket and attach the listeners, and `stop()` to
detach them. `stop()` doesn't close the socket, and calling `start()` again
re-attaches. If `stop()` is called while `start()` is still waiting on the
provider, the pending `start()` is abandoned and nothing is attached.

Errors from inbound messages never escape the gateway. A message that is too
large, can't be deserialized, or makes the handler throw is reported as an `event:error`, and
the gateway carries on with the next message. The event argument of
`event:error` is `undefined` when the failure happened before the message
became an event, so listen for it:

```ts
gateway.on('event:error', (error, event) => {
  console.error('inbound message failed', error, event?.id);
});
```

### Limiting message size

`maxPayloadSize` is the largest message, in bytes, the gateway will try to
deserialize. It defaults to `DEFAULT_MAX_PAYLOAD_SIZE`, 100 KB. Larger messages
are reported as an `event:error` without being deserialized.

```ts
const gateway = new WebSocketGateway({
  webSocketProvider: provider,
  handler,
  maxPayloadSize: 16 * 1024,
});
```

The limit is checked after the socket has received the whole message, so it
protects the deserializer and your handler, not the process's memory. To cap the
size at the transport, configure the socket library too, for example the
`maxPayload` option of a `ws` `WebSocketServer`. `WsWebSocketProvider` doesn't
pass socket options through, other than headers.

### Reconnecting automatically

With `autoRestart: true`, a gateway whose socket closes calls `start()` again,
which asks the provider for a new socket. Calling `stop()` cancels this.

```ts
const gateway = new WebSocketGateway({
  webSocketProvider: new WsWebSocketProvider({ url: 'wss://example.com/chat' }),
  handler,
  autoRestart: true,
});

await gateway.start();
```

By default a socket that closes is replaced immediately, so if the server is
down the gateway can retry in a tight loop. Set `restartDelay` to a number of
milliseconds, or `restartDelayProvider` to a function of the restart `attempt`,
to space restarts out:

```ts
const gateway = new WebSocketGateway({
  webSocketProvider: provider,
  handler,
  autoRestart: true,
  // 1s, 2s, 4s, ... capped at 30s
  restartDelayProvider: attempt => Math.min(1000 * 2 ** attempt, 30_000),
});
```

`attempt` is the number of consecutive failed restarts, so it is `0` for the
first restart after a close, and it resets once a connection opens.
`restartDelayProvider` takes precedence over `restartDelay`. When either is
set, a restart that fails is reported with `event:error` and
retried after the next delay. Without one, a failed restart is reported and the
gateway stays down until you call `start()` yourself. There is no retry limit,
and `stop()` cancels a pending delay.

With `ws`, also handle [socket errors](#socket-errors), or a failed connection
will crash the process before the gateway can retry.

## Serialization

Messages cross the socket as WebSocket data, so something has to convert between
`Event`s and that data. Each side has a pluggable piece, set with the same
component pattern as the rest of Synaptik: a function, or an object with a named
method.

**Outbound**, `eventSerializer` on the channel is `(event) => data`, or an object
with a `serialize` method. It can be async, and can return a string or binary
data. The default is `JSON.stringify`.

```ts
const channel = new WebSocketChannel<ChatEvent>({
  webSocketProvider: provider,
  eventSerializer: event =>
    JSON.stringify({ kind: event.type, payload: event.data }),
});
```

**Inbound**, `eventDeserializer` on the gateway is `(messageEvent) => event`, or
an object with a `deserialize` method. It receives the socket's `MessageEvent`,
and may be async. The default, `defaultEventDeserializer`, parses a JSON text
message and requires an object with a string `type`, a string `id`, and a `data`
property. It rejects binary messages.

```ts
import { EventBuilder } from '@sektek/synaptik';

const gateway = new WebSocketGateway({
  webSocketProvider: provider,
  eventDeserializer: async messageEvent => {
    const { kind, payload } = JSON.parse(String(messageEvent.data));

    return await EventBuilder.with({ type: kind }).create(payload);
  },
  handler,
});
```

Use matching serializers on both ends. The two sides are configured
independently, so a gateway reading what a channel wrote needs a deserializer
that understands the channel's serializer.

## Events

Both classes are event emitters and emit Synaptik's standard lifecycle events.

`WebSocketChannel`:

| Event             | Arguments        | When                                                       |
| ----------------- | ---------------- | ---------------------------------------------------------- |
| `event:received`  | `event`          | `send()` was called                                        |
| `event:delivered` | `event`          | The data was handed to the socket                          |
| `event:error`     | `error`, `event` | The provider, serializer or socket failed; `send()` throws |

`WebSocketGateway`:

| Event               | Arguments         | When                                                            |
| ------------------- | ----------------- | --------------------------------------------------------------- |
| `event:received`    | `event`           | A message was deserialized                                      |
| `event:processed`   | `event`           | The handler finished                                            |
| `event:error`       | `error`, `event?` | Size check, deserializer or handler failed, or a restart failed |
| `connection:closed` | none              | The socket closed while the gateway was started                 |

`connection:closed` is also exported as the constant `CONNECTION_CLOSED`, and
`event:received`, `event:processed`, `event:delivered` and `event:error` as
`EVENT_RECEIVED`, `EVENT_PROCESSED`, `EVENT_DELIVERED` and `EVENT_ERROR` from
`@sektek/synaptik`.

```ts
import { CONNECTION_CLOSED } from '@sektek/synaptik-ws';

gateway.on(CONNECTION_CLOSED, () => console.log('disconnected'));
```

## `WebSocketLike`

The channel, gateway and providers use a structural interface instead of a
concrete class. Both the browser `WebSocket` and `ws.WebSocket` satisfy it, so
you can pass either, or anything that implements it:

| Member                                                          | Purpose                            |
| --------------------------------------------------------------- | ---------------------------------- |
| `send(data)`                                                    | Transmit a string or binary        |
| `close(code?, reason?)`                                         | Start the close handshake          |
| `addEventListener('message' \| 'close' \| 'open', listener)`    | Listen for messages, closure, open |
| `removeEventListener('message' \| 'close' \| 'open', listener)` | Stop listening                     |
| `readyState`                                                    | See `WebSocketReadyState`          |

## License

MIT
