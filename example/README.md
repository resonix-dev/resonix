# Resonix Discord.js example bot

A minimal Discord bot that connects to a local Resonix audio node over WebSocket and lets you play a URL supported by your node.

Features

- Slash commands: /play <url>, /stop
- Joins your voice channel and streams raw PCM from Resonix

Requirements

- Node 18+
- Resonix node (default: http://127.0.0.1:2333)
- No system ffmpeg required
- Optional: enable resolving on the node via `RESONIX_RESOLVE=1` (the node now uses Riva for direct streams and auto-manages ffmpeg)

Setup

1. Copy `.env.example` to `.env` and fill in your values
2. Install deps: `pnpm i` (installs opusscript for client-side Opus)
3. Register commands (once per guild)
4. Start the bot
