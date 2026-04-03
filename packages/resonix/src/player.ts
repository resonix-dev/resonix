import {
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  StreamType,
  AudioPlayer,
  AudioPlayerStatus,
  type AudioResource,
  VoiceConnection,
  entersState,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import { Readable } from "node:stream";
import WebSocket from "ws";
import { ResonixRest } from "./rest.js";
import type {
  ResonixLoopMode,
  ResonixNodeOptions,
  ResonixTrack,
  PlayerEventMap,
} from "./types.js";
import { EventEmitter } from "./events.js";

const PCM_FRAME_BYTES = 3840;
const FRAME_DURATION_MS = 20;
const IDLE_END_GRACE_MS = 1500;
const PREBUFFER_FRAMES = 12;
const MAX_BUFFERED_FRAMES = 120;
const SILENCE_FRAME = Buffer.alloc(PCM_FRAME_BYTES);

/**
 * Simple readable stream that accepts raw PCM frame buffers pushed from the
 * Resonix websocket and exposes them to the Discord audio player.
 */
class PcmFrameStream extends Readable {
  private readonly queue: Buffer[] = [];
  private drainTimer?: NodeJS.Timeout;
  private ended = false;
  private started = false;
  private nextDrainAt = 0;
  private backpressure = false;
  private droppedFrames = 0;
  private underflowCount = 0;

  constructor(private readonly debug = false) {
    super({
      read() {},
      highWaterMark: PCM_FRAME_BYTES * 48,
    });
    this.startDrainLoop();
  }

  /** Push a single PCM packet buffer into the stream. */
  pushPacket(buf: Buffer): boolean {
    if (this.ended) return false;

    if (buf.length !== PCM_FRAME_BYTES) {
      if (this.debug) {
        console.warn(
          `[resonix] dropping malformed PCM frame (${buf.length} bytes, expected ${PCM_FRAME_BYTES})`,
        );
      }
      return false;
    }

    this.queue.push(buf);

    if (this.queue.length > MAX_BUFFERED_FRAMES) {
      const overflow = this.queue.length - MAX_BUFFERED_FRAMES;
      this.queue.splice(0, overflow);
      this.droppedFrames += overflow;
      if (this.debug && this.droppedFrames % 50 === 0) {
        console.warn(
          `[resonix] jitter buffer overflow: dropped ${this.droppedFrames} frame(s) so far`,
        );
      }
    }

    if (!this.started && this.queue.length >= PREBUFFER_FRAMES) {
      this.started = true;
    }

    return true;
  }

  hasBufferedAudio() {
    return this.queue.length > 0;
  }

  queuedFrames() {
    return this.queue.length;
  }

  isReadyToStart() {
    return this.started;
  }

  override _read() {
    this.backpressure = false;
  }

  private scheduleDrain(nextDelayMs: number) {
    this.drainTimer = setTimeout(() => {
      this.drainOnce();
    }, nextDelayMs);
    this.drainTimer.unref?.();
  }

  private drainOnce() {
    if (this.ended) {
      return;
    }

    if (!this.started || this.backpressure) {
      this.nextDrainAt = Date.now() + FRAME_DURATION_MS;
      this.scheduleDrain(FRAME_DURATION_MS);
      return;
    }

    const frame = this.queue.shift();
    if (!frame) {
      this.underflowCount += 1;
      if (this.debug && this.underflowCount % 25 === 0) {
        console.warn(
          `[resonix] jitter buffer underflow count: ${this.underflowCount}`,
        );
      }
      // Feed one silence frame to keep Discord player cadence stable during
      // transient packet jitter, then force re-prebuffer for real audio.
      this.backpressure = !this.push(SILENCE_FRAME);
      this.started = false;
      this.nextDrainAt += FRAME_DURATION_MS;
      const delay = Math.max(0, this.nextDrainAt - Date.now());
      this.scheduleDrain(delay);
      return;
    }

    this.backpressure = !this.push(frame);
    this.nextDrainAt += FRAME_DURATION_MS;
    const delay = Math.max(0, this.nextDrainAt - Date.now());
    this.scheduleDrain(delay);
  }

  private startDrainLoop() {
    this.nextDrainAt = Date.now() + FRAME_DURATION_MS;
    this.scheduleDrain(FRAME_DURATION_MS);
  }

  /** Signal that no more frames will arrive. */
  endStream() {
    if (this.ended) return;
    this.ended = true;
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = undefined;
    }
    this.queue.length = 0;
    this.push(null);
  }
}

/**
 * High-level wrapper that manages a Discord voice connection and bridges
 * PCM frames from a Resonix backend player into Discord's audio pipeline.
 * Extends EventEmitter for event-driven architecture (erela.js-like).
 */
export class ResonixPlayer extends EventEmitter<PlayerEventMap> {
  public readonly id: string;
  public readonly guildId: string;
  public readonly connection: VoiceConnection;
  public readonly audioPlayer: AudioPlayer;
  private ws?: WebSocket;
  private stream?: PcmFrameStream;
  private resource?: AudioResource;
  private currentTrack?: ResonixTrack;
  private finishedEmittedForCurrentTrack = false;
  private idleFinishTimer?: NodeJS.Timeout;
  private lastPacketAt = 0;
  private isDestroyed = false;

  /** Cancel any pending idle-to-finished transition. */
  private clearIdleFinishTimer() {
    if (!this.idleFinishTimer) return;
    clearTimeout(this.idleFinishTimer);
    this.idleFinishTimer = undefined;
  }

  /**
   * Audio starvation can briefly transition to Idle under load. Delay end
   * signaling so transient network/CPU blips do not terminate playback.
   */
  private scheduleFinishedFromIdle() {
    this.clearIdleFinishTimer();
    if (
      !this.currentTrack ||
      this.isDestroyed ||
      this.finishedEmittedForCurrentTrack
    ) {
      return;
    }

    const trackAtSchedule = this.currentTrack;
    this.idleFinishTimer = setTimeout(() => {
      this.idleFinishTimer = undefined;

      if (this.isDestroyed || this.finishedEmittedForCurrentTrack) return;
      if (!this.currentTrack || this.currentTrack !== trackAtSchedule) return;
      if (this.audioPlayer.state.status !== AudioPlayerStatus.Idle) return;

      const sinceLastPacket = Date.now() - this.lastPacketAt;
      if (sinceLastPacket < IDLE_END_GRACE_MS) return;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        if (this.stream?.hasBufferedAudio()) return;
      }

      this.finishedEmittedForCurrentTrack = true;
      this.emit("trackEnd", {
        player: this.id,
        track: this.currentTrack,
        reason: "finished",
      }).catch((e) => console.error("[resonix] error emitting trackEnd", e));
    }, IDLE_END_GRACE_MS);
    this.idleFinishTimer.unref?.();
  }

  /** Ensure a fresh PCM stream + Discord audio resource exist. */
  private initResource() {
    if (this.stream && this.resource) return;
    this.stream?.endStream();
    this.stream = new PcmFrameStream(Boolean(this.opts.debug));
    this.resource = createAudioResource(this.stream, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
    if (this.opts.debug)
      console.log("[resonix] audio resource (re)created (raw)");
  }

  /** Tear down the local PCM stream + audio resource. */
  private clearResource() {
    this.stream?.endStream();
    this.stream = undefined;
    this.resource = undefined;
  }

  /**
   * @param rest REST client used for control operations.
   * @param opts Node options (base URL + version + misc overrides).
   * @param guildId Guild identifier this player is bound to.
   * @param connection Established Discord voice connection.
   */
  constructor(
    private readonly rest: ResonixRest,
    private readonly opts: ResonixNodeOptions,
    guildId: string,
    connection: VoiceConnection,
  ) {
    super();
    this.guildId = guildId;
    this.id = `g${guildId}`;
    this.connection = connection;
    this.audioPlayer = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });
    this.connection.subscribe(this.audioPlayer);

    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      if (this.opts.debug)
        console.log("[resonix] audio player idle, awaiting next frames");

      this.scheduleFinishedFromIdle();
    });

    this.audioPlayer.on(AudioPlayerStatus.Playing, () => {
      if (this.currentTrack) {
        console.log(`[resonix] playing ${this.currentTrack.uri}`);
      }
    });

    if (this.opts.debug) {
      this.audioPlayer.on("debug", (m) => console.log("[resonix] ap debug", m));
      this.audioPlayer.on("error", (e) => console.error("[resonix] ap error", e));
    }
  }

  private ensurePlayerStarted() {
    const resource = this.resource;
    const stream = this.stream;
    if (!resource || !stream || !stream.isReadyToStart()) return;

    const status = this.audioPlayer.state.status;
    if (
      status === AudioPlayerStatus.Idle ||
      status === AudioPlayerStatus.AutoPaused
    ) {
      this.audioPlayer.play(resource);
      if (this.opts.debug)
        console.log("[resonix] resumed audio player after idle");
      return;
    }

    if (status === AudioPlayerStatus.Paused) {
      this.audioPlayer.unpause();
    }
  }

  /**
   * Begin playback of a new audio source URI.
   * Existing websocket / stream state is torn down before starting.
   * @param uri Audio source (file path / URL) supported by backend.
   * @param metadata Optional metadata to associate with the track.
   */
  async play(uri: string, metadata?: Record<string, unknown>) {
    const hasActiveStream =
      this.ws !== undefined && this.ws.readyState === WebSocket.OPEN;

    if (hasActiveStream) {
      const res = await this.rest.enqueue(this.id, { uri, metadata });
      const suffix = res?.trackId ? ` (track ${res.trackId})` : "";
      console.log(`[resonix] queued track ${uri}${suffix}`);
      
      const queuedTrack: ResonixTrack = { uri, metadata, trackId: res?.trackId };
      this.emit("trackQueued", {
        player: this.id,
        track: queuedTrack,
        position: 1, // queued for next
      }).catch((e) => console.error("[resonix] error emitting trackQueued", e));
      
      return;
    }

    await this.rest.deletePlayer(this.id).catch(() => undefined);
    this.ws?.close();
    this.ws = undefined;
    this.clearResource();
    this.audioPlayer.stop();

    const trackToPlay: ResonixTrack = { uri, metadata };
    this.currentTrack = trackToPlay;
    this.finishedEmittedForCurrentTrack = false;
    this.clearIdleFinishTimer();
    this.lastPacketAt = 0;

    await this.rest.createPlayer({ id: this.id, uri });
    await this.rest.play(this.id);

    const version = this.opts.version ? `/${this.opts.version}` : "";
    const base = this.opts.baseUrl.replace(/\/$/, "");
    const wsUrl = `${base.replace("http://", "ws://").replace("https://", "wss://")}${version}/players/${this.id}/ws`;
    this.ws = new WebSocket(wsUrl, {
      perMessageDeflate: false,
    });
    this.initResource();

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 10_000);
    } catch {}
    // Delay initial playback until jitter buffer has preloaded enough frames.
    this.ensurePlayerStarted();

    let pkt = 0;
    let droppedInvalidFrames = 0;
    this.ws.on("message", (data: WebSocket.RawData) => {
      this.clearIdleFinishTimer();
      this.lastPacketAt = Date.now();

      const buf = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data as unknown as Buffer);

      this.initResource();
      const stream = this.stream;
      if (!stream) return;

      if (!stream.pushPacket(buf as Buffer)) {
        droppedInvalidFrames += 1;
        if (this.opts.debug && droppedInvalidFrames % 25 === 0) {
          console.warn(
            `[resonix] dropped invalid frames: ${droppedInvalidFrames}`,
          );
        }
        return;
      }

      this.ensurePlayerStarted();

      if (this.opts.debug && (pkt < 5 || pkt % 100 === 0)) {
        let energy = 0;
        if (buf.length >= 4) {
          const sampleCount = Math.min(50, buf.length / 2);
          for (let i = 0; i < sampleCount; i++) {
            const sample = buf.readInt16LE(i * 2);
            energy += Math.abs(sample);
          }
          energy = Math.round(energy / sampleCount);
        }
        console.log(
          `[resonix] frame ${pkt + 1} ${buf.length} bytes` +
            (energy ? ` energy~${energy}` : " energy=0") +
            ` q=${stream.queuedFrames()}`,
        );
        if (energy === 0 && pkt < 5) {
          console.warn(
            "[resonix] warning: zero energy frame(s) - incoming audio may be silent or format mismatch (expect s16le stereo 48k).",
          );
        }
      }
      pkt++;
    });

    // Emit trackStart event when we start receiving audio
    let trackStartEmitted = false;
    this.ws.on("open", () => {
      if (!trackStartEmitted && this.currentTrack) {
        trackStartEmitted = true;
        this.emit("trackStart", {
          player: this.id,
          track: this.currentTrack,
        }).catch((e) => console.error("[resonix] error emitting trackStart", e));
      }
    });

    this.ws.on("close", () => {
      this.clearIdleFinishTimer();
      this.clearResource();
      this.ws = undefined;
    });
    
    this.ws.on("error", (e) => {
      console.error("[resonix] ws error", e);
      this.clearIdleFinishTimer();
      if (this.currentTrack) {
        this.emit("playerError", {
          player: this.id,
          error: e instanceof Error ? e : new Error(String(e)),
        }).catch((err) => console.error("[resonix] error emitting playerError", err));
      }
      this.clearResource();
      this.ws = undefined;
    });
  }

  /** Pause both remote backend and local audio player. */
  async pause() {
    await this.rest.pause(this.id);
    this.audioPlayer.pause();
    
    if (this.currentTrack) {
      this.emit("playerPause", {
        player: this.id,
        track: this.currentTrack,
      }).catch((e) => console.error("[resonix] error emitting playerPause", e));
    }
  }

  /** Resume playback (remote + local). */
  async resume() {
    await this.rest.play(this.id);
    this.audioPlayer.unpause();
    
    if (this.currentTrack) {
      this.emit("playerResume", {
        player: this.id,
        track: this.currentTrack,
      }).catch((e) => console.error("[resonix] error emitting playerResume", e));
    }
  }
  /** Adjust remote volume filter (range enforced by backend). */
  async setVolume(v: number) {
    await this.rest.filters(this.id, { volume: v });
  }

  /** Skip the currently playing track (remote queue). */
  async skip() {
    await this.rest.skip(this.id);
  }

  /** Update the backend loop mode. */
  async setLoopMode(mode: ResonixLoopMode) {
    await this.rest.setLoopMode(this.id, mode);
    console.log(`[resonix] loop mode -> ${mode}`);
  }

  /**
   * Tear down websocket, stream, audio player and inform the backend.
   * Safe to call multiple times.
   */
  destroy() {
    this.isDestroyed = true;
    this.clearIdleFinishTimer();
    this.ws?.close();
    this.clearResource();
    this.audioPlayer.stop();
    this.ws = undefined;
    void this.rest.deletePlayer(this.id);

    if (this.currentTrack && !this.finishedEmittedForCurrentTrack) {
      this.finishedEmittedForCurrentTrack = true;
      this.emit("trackEnd", {
        player: this.id,
        track: this.currentTrack,
        reason: "cleanup",
      }).catch((e) => console.error("[resonix] error emitting trackEnd on destroy", e));
    }

    this.currentTrack = undefined;
    this.removeAllListeners();
  }
}
