# Resonix Discord.js example bot

A minimal Discord bot that connects to a local Resonix audio node over WebSocket and lets you play a URL supported by your node.

Features

- Slash commands: /play <url>, /stop, /pause, /resume, /skip, /loopmode, /volume, /join, /leave
- Joins your voice channel and streams raw PCM from Resonix
- Event logging: All player events are logged to a configured Discord channel (trackStart, trackEnd, playerError, etc.)

Requirements

- Node 18+
- Resonix node (default: http://127.0.0.1:2333)
- No system ffmpeg required
- Optional: enable resolving on the node via `RESONIX_RESOLVE=1` (the node now uses Riva for direct streams and auto-manages ffmpeg)

Setup

1. Copy `.env.example` to `.env` and fill in your values
2. Set `LOG_CHANNEL_ID` in your `.env` to a Discord channel where events will be logged
3. Install deps: `pnpm i` (installs opusscript for client-side Opus)
4. Register commands (once per guild)
5. Start the bot

The bot will now emit events to your configured log channel for all player lifecycle events!
