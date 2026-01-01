# resonix.js

Simple opinionated JavaScript/TypeScript client for a Resonix audio node with event-driven architecture (inspired by erela.js).

Focus: minimal surface (join, play, pause, resume, volume) and raw PCM streaming over the builtin Resonix websocket just like the reference example, now with a powerful event system!

## Install

```bash
npm i resonix.js
# or
pnpm i resonix.js
# or
yarn add resonix.js
# or
bun add resonix.js
```

## Quick start

```ts
import { Client, GatewayIntentBits } from "discord.js";
import { ResonixNode, ResonixManager } from "resonix.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const node = new ResonixNode({
  baseUrl: "http://localhost:2333",
  version: "v0",
});
const manager = new ResonixManager(client, node);

// Listen for player events (manager level)
manager.on("trackStart", (event) => {
  console.log(`Track started: ${event.track.uri} on player ${event.player}`);
});

manager.on("trackEnd", (event) => {
  console.log(`Track ended: ${event.track.uri}`);
});

manager.on("playerError", (event) => {
  console.error(`Player error: ${event.error.message}`);
});

// Get a player and play a track
const player = await manager.create(guildId, connection);
await player.play("https://example.com/audio.mp3", { title: "My Song" });
```

## Event System

resonix.js uses a Node.js-inspired EventEmitter pattern for event-driven development:

### Manager Events

Listen to events on the manager to handle all players at once:

```ts
manager.on("trackStart", async (event) => {
  const { player, track } = event;
  console.log(`Now playing: ${track.uri}`);
});

manager.on("trackEnd", async (event) => {
  const { player, track, reason } = event;
  // reason: "finished" | "stopped" | "replaced" | "cleanup"
  console.log(`Track ended due to: ${reason}`);
});

manager.on("playerError", async (event) => {
  const { player, error } = event;
  console.error(`Error on player ${player}: ${error.message}`);
});

manager.on("trackQueued", async (event) => {
  const { player, track, position } = event;
  console.log(`Queued ${track.uri} at position ${position}`);
});

manager.on("playerPause", async (event) => {
  const { player, track } = event;
  console.log(`Paused: ${track.uri}`);
});

manager.on("playerResume", async (event) => {
  const { player, track } = event;
  console.log(`Resumed: ${track.uri}`);
});

manager.on("playerCreate", async (event) => {
  const { player, guildId } = event;
  console.log(`Player created for guild ${guildId}`);
});

manager.on("playerDestroy", async (event) => {
  const { player, guildId } = event;
  console.log(`Player destroyed for guild ${guildId}`);
});
```

### Player Events

You can also listen to events on individual players:

```ts
const player = await manager.create(guildId, connection);

player.on("trackStart", ({ track }) => {
  console.log(`Now playing on guild player: ${track.uri}`);
});

player.on("trackEnd", ({ track, reason }) => {
  console.log(`Finished playing: ${track.uri}`);
});
```

### Event Listener Methods

All event listeners support both synchronous and asynchronous callbacks:

```ts
// Register a listener (multiple listeners allowed)
manager.on("trackStart", async (event) => {
  // Handle event
});

// Register a one-time listener
manager.once("trackEnd", async (event) => {
  console.log("This runs only once!");
});

// Remove a specific listener
const listener = (event) => { /* ... */ };
manager.on("playerError", listener);
manager.off("playerError", listener);

// Remove all listeners for an event
manager.removeAllListeners("trackStart");

// Remove all listeners
manager.removeAllListeners();

// Get listener count
const count = manager.listenerCount("trackStart");
```

## Design Notes

- One player per guild (id = `g<guildId>`)
- Resonix handles decoding and pacing; we pipe 20ms raw PCM frames straight into an `AudioResource` (StreamType.Raw, S16LE stereo 48k)
- No track queue abstraction included yet (keep it light). You can layer your own queue before calling `player.play(uri)`.
- Event emitters are fully async-safe; listeners can be async functions and errors are safely caught
- Events follow erela.js patterns for familiar developer experience

## Roadmap

- WebSocket state change events
- Automatic voice state tracking (move / disconnect)
- Retry & reconnection logic for WS

- Built-in queue & search helpers

PRs welcome.
