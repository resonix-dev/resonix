import {
  joinVoiceChannel,
  VoiceConnection,
  entersState,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import type { Client, Snowflake } from "discord.js";
import { ResonixNode } from "./node.js";
import { ResonixPlayer } from "./player.js";

export interface JoinOptions {
  guildId: Snowflake;
  voiceChannelId: Snowflake;
  adapterCreator: any;
  selfDeaf?: boolean;
}

/**
 * Orchestrates creation / lifecycle of {@link ResonixPlayer} instances per guild.
 */
export class ResonixManager {
  private players = new Map<Snowflake, ResonixPlayer>();
  /**
   * @param client Discord.js client instance.
   * @param node Resonix node (REST endpoint + options).
   */
  constructor(
    public readonly client: Client,
    public readonly node: ResonixNode,
  ) {}

  /**
   * Join a voice channel and resolve when the connection is ready.
   * @throws Propagates errors if the voice connection doesn't become ready in time.
   */
  async join(opts: JoinOptions) {
    const connection = joinVoiceChannel({
      channelId: opts.voiceChannelId,
      guildId: opts.guildId,
      adapterCreator: opts.adapterCreator,
      selfDeaf: opts.selfDeaf ?? true,
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    } catch (e) {
      connection.destroy();
      throw e;
    }
    return connection;
  }

  async create(guildId: Snowflake, connection: VoiceConnection) {
    let p = this.players.get(guildId);
    if (!p) {
      p = new ResonixPlayer(
        this.node.rest,
        this.node.options,
        guildId,
        connection,
      );
      this.players.set(guildId, p);
    }
    return p;
  }

  get(guildId: Snowflake) {
    return this.players.get(guildId);
  }

  /** Destroy and dispose of a player for the given guild. */
  async destroy(guildId: Snowflake) {
    const p = this.players.get(guildId);
    if (p) {
      p.destroy();
      this.players.delete(guildId);
    }
  }

  /** Leave a guild (alias for destroy). */
  async leave(guildId: Snowflake) {
    await this.destroy(guildId);
  }
}
