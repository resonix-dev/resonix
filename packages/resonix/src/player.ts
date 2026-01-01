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

/**
 * Simple readable stream that accepts raw PCM frame buffers pushed from the
 * Resonix websocket and exposes them to the Discord audio player.
 */
class PcmFrameStream extends Readable {
  constructor() {
    super({ read() {} });
  }
  /** Push a single PCM packet buffer into the stream. */
  pushPacket(buf: Buffer) {
    this.push(buf);
  }
  /** Signal that no more frames will arrive. */
  endStream() {
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
  private isDestroyed = false;

  /** Ensure a fresh PCM stream + Discord audio resource exist. */
  private initResource() {
    if (this.stream && this.resource) return;
    this.stream?.endStream();
    this.stream = new PcmFrameStream();
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
      
      if (this.currentTrack && !this.isDestroyed) {
        this.emit("trackEnd", {
          player: this.id,
          track: this.currentTrack,
          reason: "finished",
        }).catch((e) => console.error("[resonix] error emitting trackEnd", e));
      }
      this.clearResource();
    });
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

    await this.rest.createPlayer({ id: this.id, uri });
    await this.rest.play(this.id);

    const version = this.opts.version ? `/${this.opts.version}` : "";
    const base = this.opts.baseUrl.replace(/\/$/, "");
    const wsUrl = `${base.replace("http://", "ws://").replace("https://", "wss://")}${version}/players/${this.id}/ws`;
    this.ws = new WebSocket(wsUrl);
    this.initResource();

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 10_000);
    } catch {}
    if (this.resource) this.audioPlayer.play(this.resource);
    if (this.opts.debug) {
      this.audioPlayer.on("debug", (m) => console.log("[resonix] ap debug", m));
      this.audioPlayer.on("error", (e) =>
        console.error("[resonix] ap error", e),
      );
    }

    let pkt = 0;
    this.ws.on("message", (data: WebSocket.RawData) => {
      const buf = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data as unknown as Buffer);
      this.initResource();
      const stream = this.stream;
      let resource = this.resource;
      if (!stream || !resource) return;

      const status = this.audioPlayer.state.status;
      if (
        status === AudioPlayerStatus.Idle ||
        status === AudioPlayerStatus.AutoPaused
      ) {
        try {
          this.audioPlayer.play(resource);
          if (this.opts.debug)
            console.log("[resonix] resumed audio player after idle");
        } catch (err) {
          if (err instanceof Error && err.message.includes("already ended")) {
            this.clearResource();
            this.initResource();
            resource = this.resource;
            if (resource) {
              this.audioPlayer.play(resource);
            }
          } else {
            throw err;
          }
        }
      } else if (status === AudioPlayerStatus.Paused) {
        this.audioPlayer.unpause();
      }
      if (pkt < 5 || this.opts.debug) {
        // Expect 20ms 48kHz stereo s16le => 48000 * 2 (stereo) * 2 (bytes) * 0.02 = 3840 bytes
        const expected = 3840;
        let energy = 0;
        if (buf.length >= 4) {
          // compute average absolute sample value over first 50 samples for quick sanity
          const sampleCount = Math.min(50, buf.length / 2);
          for (let i = 0; i < sampleCount; i++) {
            const sample = buf.readInt16LE(i * 2);
            energy += Math.abs(sample);
          }
          energy = Math.round(energy / sampleCount);
        }
        console.log(
          `[resonix] frame ${pkt + 1} ${buf.length} bytes` +
            (buf.length !== expected ? ` (WARN size!=${expected})` : "") +
            (energy ? ` energy~${energy}` : " energy=0"),
        );
        if (energy === 0 && pkt < 5) {
          console.warn(
            "[resonix] warning: zero energy frame(s) - incoming audio may be silent or format mismatch (expect s16le stereo 48k).",
          );
        }
      }
      pkt++;
      stream.pushPacket(buf as Buffer);
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
      this.clearResource();
      this.ws = undefined;
    });
    
    this.ws.on("error", (e) => {
      console.error("[resonix] ws error", e);
      if (this.currentTrack) {
        this.emit("playerError", {
          player: this.id,
          error: e instanceof Error ? e : new Error(String(e)),
        }).catch((err) => console.error("[resonix] error emitting playerError", err));
      }
      this.clearResource();
      this.ws = undefined;
    });

    this.audioPlayer.on(AudioPlayerStatus.Playing, () => {
      console.log(`[resonix] playing ${uri}`);
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
    this.ws?.close();
    this.clearResource();
    this.audioPlayer.stop();
    this.ws = undefined;
    void this.rest.deletePlayer(this.id);
    
    if (this.currentTrack) {
      this.emit("trackEnd", {
        player: this.id,
        track: this.currentTrack,
        reason: "cleanup",
      }).catch((e) => console.error("[resonix] error emitting trackEnd on destroy", e));
    }
    
    this.removeAllListeners();
  }
}
