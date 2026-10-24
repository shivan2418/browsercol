# The Browser UI attaches through a WebGUI subclass of FreeCol's GUI

The Browser UI (TypeScript, PixiJS for the map, React for panels) does not speak FreeCol's protocol itself. Instead a Java `WebGUI` subclass of FreeCol's `GUI` class is compiled into the client Engine alongside FreeCol's own controllers; the controllers decide what to show and ask, and `WebGUI` hands each request to the Browser UI and returns the player's answer. This reuses ~9.7K lines of client logic and keeps new code to drawing and input, at the price of a Java class living in a browser game.

The client Engine runs on the main thread so the Browser UI can read game state directly; the server Engine and AI run in a Web Worker, talking to the client only through FreeCol's protocol messages over `postMessage`, so a WebSocket to a hosted server can replace the Worker later without touching the client.

## Considered Options

- A TypeScript client that speaks FreeCol's protocol directly: rejected, reimplements the client controllers.
- The whole Engine in one Worker: rejected, every map repaint would need state copied across threads, and the client/server line would no longer match a future hosted server.
