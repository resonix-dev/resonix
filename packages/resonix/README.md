# resonix.js

Simple opinionated JavaScript/TypeScript client for a Resonix audio node.

Focus: minimal surface (join, play, pause, resume, volume) and raw PCM streaming over the builtin Resonix websocket just like the reference example.

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

// on interaction => join + play
```

See `examples/discord-js-bot` in the main repository for an integration usage pattern.

## Design Notes

- One player per guild (id = `g<guildId>`)
- Resonix handles decoding and pacing; we pipe 20ms raw PCM frames straight into an `AudioResource` (StreamType.Raw, S16LE stereo 48k)
- No track queue abstraction included yet (keep it light). You can layer your own queue before calling `player.play(uri)`.

## Roadmap

- Events (track start/end/error) if/when exposed by Resonix
- Automatic voice state tracking (move / disconnect)
- Retry & reconnection logic for WS
- Built-in queue & search helpers

PRs welcome.
