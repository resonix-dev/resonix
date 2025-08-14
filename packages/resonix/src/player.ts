import {
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  StreamType,
  AudioPlayer,
  AudioPlayerStatus,
  VoiceConnection,
  entersState,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import { Readable } from "node:stream";
import WebSocket from "ws";
import { ResonixRest } from "./rest.js";
import type { ResonixNodeOptions } from "./types.js";

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
 */
export class ResonixPlayer {
  public readonly id: string;
  public readonly guildId: string;
  public readonly connection: VoiceConnection;
  public readonly audioPlayer: AudioPlayer;
  private ws?: WebSocket;
  private stream?: PcmFrameStream;

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
    this.guildId = guildId;
    this.id = `g${guildId}`;
    this.connection = connection;
    this.audioPlayer = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });
    this.connection.subscribe(this.audioPlayer);
  }

  /**
   * Begin playback of a new audio source URI.
   * Existing websocket / stream state is torn down before starting.
   * @param uri Audio source (file path / URL) supported by backend.
   */
  async play(uri: string) {
    // Cleanup existing
    await this.rest.deletePlayer(this.id).catch(() => undefined);
    this.ws?.close();
    this.ws = undefined;
    this.stream?.endStream();
    this.stream = undefined;
    this.audioPlayer.stop();

    await this.rest.createPlayer({ id: this.id, uri });
    await this.rest.play(this.id);

    const version = this.opts.version ? `/${this.opts.version}` : "";
    const base = this.opts.baseUrl.replace(/\/$/, "");
    const wsUrl = `${base.replace("http://", "ws://").replace("https://", "wss://")}${version}/players/${this.id}/ws`;
    this.ws = new WebSocket(wsUrl);
    this.stream = new PcmFrameStream();
    const resource = createAudioResource(this.stream, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
    if (this.opts.debug) console.log("[resonix] audio resource created (raw)");

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 10_000);
    } catch {}
    this.audioPlayer.play(resource);
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
      this.stream?.pushPacket(buf as Buffer);
    });
    this.ws.on("close", () => {
      this.stream?.endStream();
    });
    this.ws.on("error", (e) => {
      console.error("[resonix] ws error", e);
      this.stream?.endStream();
    });

    this.audioPlayer.on(AudioPlayerStatus.Playing, () =>
      console.log(`[resonix] playing ${uri}`),
    );
  }

  /** Pause both remote backend and local audio player. */
  async pause() {
    await this.rest.pause(this.id);
    this.audioPlayer.pause();
  }
  /** Resume playback (remote + local). */
  async resume() {
    await this.rest.play(this.id);
    this.audioPlayer.unpause();
  }
  /** Adjust remote volume filter (range enforced by backend). */
  async setVolume(v: number) {
    await this.rest.filters(this.id, { volume: v });
  }

  /**
   * Tear down websocket, stream, audio player and inform the backend.
   * Safe to call multiple times.
   */
  destroy() {
    this.ws?.close();
    this.stream?.endStream();
    this.audioPlayer.stop();
    void this.rest.deletePlayer(this.id);
  }
}
