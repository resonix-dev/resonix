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
 * Represents a track being played.
 */
export interface ResonixTrack {
  uri: string;
  metadata?: Record<string, unknown>;
  trackId?: string;
}

/**
 * Event emitted when a track starts playing.
 */
export interface TrackStartEvent {
  player: string; // player id
  track: ResonixTrack;
}

/**
 * Event emitted when a track ends.
 */
export interface TrackEndEvent {
  player: string; // player id
  track: ResonixTrack;
  reason: "finished" | "stopped" | "replaced" | "cleanup";
}

/**
 * Event emitted when a track fails to play.
 */
export interface TrackErrorEvent {
  player: string; // player id
  track: ResonixTrack;
  error: Error;
}

/**
 * Event emitted when the player encounters an error.
 */
export interface PlayerErrorEvent {
  player: string; // player id
  error: Error;
}

/**
 * Event emitted when a track is queued.
 */
export interface TrackQueuedEvent {
  player: string; // player id
  track: ResonixTrack;
  position: number;
}

/**
 * Event emitted when playback is paused.
 */
export interface PlayerPauseEvent {
  player: string; // player id
  track: ResonixTrack;
}

/**
 * Event emitted when playback resumes.
 */
export interface PlayerResumeEvent {
  player: string; // player id
  track: ResonixTrack;
}

/**
 * Event emitted when a player is created.
 */
export interface PlayerCreateEvent {
  player: string; // player id
  guildId: Snowflake;
}

/**
 * Event emitted when a player is destroyed.
 */
export interface PlayerDestroyEvent {
  player: string; // player id
  guildId: Snowflake;
}

/**
 * Union type of all possible player events.
 */
export type PlayerEventMap = {
  trackStart: [TrackStartEvent];
  trackEnd: [TrackEndEvent];
  trackError: [TrackErrorEvent];
  playerError: [PlayerErrorEvent];
  trackQueued: [TrackQueuedEvent];
  playerPause: [PlayerPauseEvent];
  playerResume: [PlayerResumeEvent];
  playerCreate: [PlayerCreateEvent];
  playerDestroy: [PlayerDestroyEvent];
};

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

/** Looping behavior supported by the backend resolver. */
export type ResonixLoopMode = "none" | "track" | "queue";

/** Payload accepted by the /queue endpoint for appending tracks. */
export interface ResonixEnqueuePayload {
  uri: string;
  metadata?: Record<string, unknown>;
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
