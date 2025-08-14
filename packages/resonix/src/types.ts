import type { VoiceConnection } from "@discordjs/voice";
import type { Snowflake } from "discord.js";

/**
 * Runtime state reported for a playing track / player instance.
 */
export interface ResonixPlayerState {
  position: number;
  paused: boolean;
  volume: number; // 0.0 - 5.0
}

/**
 * Payload used when creating a new remote player on the Resonix backend.
 * The id is a locally decided identifier (guild based in this lib) and `uri` is
 * the audio source (file path / URL) supported by the backend.
 */
export interface CreatePlayerPayload {
  id: string; // player id
  uri: string;
}

/**
 * Filters / DSP adjustments to apply to the player.
 */
export interface ResonixFiltersPayload {
  volume?: number;
}

/**
 * Options when instantiating a {@link ResonixNode}. These map to the server base URL
 * and feature toggles for the runtime.
 */
export interface ResonixNodeOptions {
  baseUrl: string; // http://host:port
  version?: string; // e.g. "v0"
  fetch?: typeof fetch;
  ws?: typeof WebSocket;
  shardCount?: number;
  userId?: Snowflake;
  /** Enable verbose debug logging (frames, energy, state). */
  debug?: boolean;
}

/**
 * Options provided to {@link ResonixPlayer#play} to begin playback.
 */
export interface PlayOptions {
  uri: string;
  guildId: Snowflake;
}

/**
 * Internal bookkeeping details for a managed player (guild association + voice connection).
 */
export interface PlayerInternals {
  id: string;
  guildId: Snowflake;
  connection: VoiceConnection;
}

/**
 * Event: a track has started on the backend and PCM frames will follow.
 */
export interface ResonixTrackStartEvent {
  op: "trackStart";
  id: string;
  uri: string;
}

/**
 * Event: raw 16‑bit PCM frame data chunk.
 */
export interface ResonixPcmFrameEvent {
  op: "pcm";
  data: ArrayBuffer;
}

/**
 * Union of all events that can be emitted by the Resonix WebSocket connection.
 */
export type ResonixAnyEvent = ResonixTrackStartEvent | ResonixPcmFrameEvent;
