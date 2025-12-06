import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
} from "discord.js";
import {
  ResonixNode,
  ResonixManager,
} from "../../packages/resonix/dist/index.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const RESONIX_BASE = process.env.RESONIX_BASE || "http://localhost:2333";

// --- Commands ---
const commands = [
  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Join your voice channel"),
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Leave the voice channel"),
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a URL via Resonix")
    .addStringOption((o) =>
      o.setName("url").setDescription("Direct media URL").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop playback and clear the queue"),
  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current track"),
  new SlashCommandBuilder()
    .setName("loopmode")
    .setDescription("Set the loop mode")
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("Loop mode")
        .setRequired(true)
        .addChoices(
          { name: "off", value: "off" },
          { name: "track", value: "track" },
          { name: "queue", value: "queue" },
        ),
    ),
  new SlashCommandBuilder().setName("pause").setDescription("Pause playback"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set volume (0.0-5.0)")
    .addNumberOption((o) =>
      o
        .setName("value")
        .setDescription("Volume level (0.0-5.0)")
        .setRequired(true),
    ),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const node = new ResonixNode({ baseUrl: RESONIX_BASE, version: "v0" });
const manager = new ResonixManager(client, node);

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    await registerCommands();
    console.log("Commands registered");
  } catch (e) {
    console.error("Slash registration failed", e);
  }
});

client.on("interactionCreate", async (itx) => {
  if (!itx.isChatInputCommand()) return;
  const gid = itx.guildId;
  await itx.deferReply({ flags: 64 });
  switch (itx.commandName) {
    case "join": {
      const me = itx.member;
      const ch = me?.voice?.channel;
      if (!ch || ch.type !== ChannelType.GuildVoice)
        return void itx.editReply({
          content: "Join a voice channel first.",
          flags: 64, // ephemeral
        });
      try {
        const conn = await manager.join({
          guildId: gid,
          voiceChannelId: ch.id,
          adapterCreator: ch.guild.voiceAdapterCreator,
        });
        await manager.create(gid, conn);
        return void itx.editReply({ content: "Joined.", flags: 64 });
      } catch {
        return void itx.editReply({
          content: "Failed to join",
          flags: 64, // ephemeral
        });
      }
    }
    case "leave": {
      await manager.leave(gid);
      return void itx.editReply({ content: "Left.", flags: 64 });
    }
    case "stop": {
      const p = manager.get(gid);
      if (!p)
        return void itx.editReply({
          content: "Nothing to stop.",
          flags: 64, // ephemeral
        });
      p.destroy();
      return void itx.editReply({ content: "Stopped.", flags: 64 });
    }
    case "skip": {
      const p = manager.get(gid);
      if (!p)
        return void itx.editReply({
          content: "Nothing to skip.",
          flags: 64, // ephemeral
        });
      try {
        await p.skip();
        return void itx.editReply({ content: "Skipped.", flags: 64 });
      } catch (err) {
        console.error("Skip failed", err);
        return void itx.editReply({
          content: "Skip failed.",
          flags: 64,
        });
      }
    }
    case "loopmode": {
      const m = itx.options.getString("mode", true);
      const p = manager.get(gid);
      if (!p)
        return void itx.editReply({
          content: "No player.",
          flags: 64, // ephemeral
        });
      let mode = "none";
      if (m === "track") mode = "track";
      else if (m === "queue") mode = "queue";
      try {
        await p.setLoopMode(mode);
        return void itx.editReply({ content: `Loop mode -> ${m}`, flags: 64 });
      } catch (err) {
        console.error("Loop mode failed", err);
        return void itx.editReply({
          content: "Loop mode failed.",
          flags: 64,
        });
      }
    }
    case "play": {
      const url = itx.options.getString("url", true);
      let p = manager.get(gid);
      if (!p) {
        const me = itx.member;
        const ch = me?.voice?.channel;
        if (!ch || ch.type !== ChannelType.GuildVoice)
          return void itx.editReply({
            content: "Join a voice channel first.",
            flags: 64, // ephemeral
          });
        const conn = await manager.join({
          guildId: gid,
          voiceChannelId: ch.id,
          adapterCreator: ch.guild.voiceAdapterCreator,
        });
        p = await manager.create(gid, conn);
      }
      await p.play(url).catch((e) => {
        console.error(e);
      });
      return void itx.editReply(`Playing: ${url}`);
    }
    case "pause": {
      const p = manager.get(gid);
      if (!p)
        return void itx.editReply({
          content: "Nothing to pause.",
          flags: 64, // ephemeral
        });
      await p.pause().catch(() => {});
      return void itx.editReply({ content: "Paused.", flags: 64 });
    }
    case "resume": {
      const p = manager.get(gid);
      if (!p)
        return void itx.editReply({
          content: "Nothing to resume.",
          flags: 64, // ephemeral
        });
      await p.resume().catch(() => {});
      return void itx.editReply({ content: "Resumed.", flags: 64 });
    }
    case "volume": {
      const v = itx.options.getNumber("value", true);
      const p = manager.get(gid);
      if (!p) return void itx.editReply({ content: "No player.", flags: 64 });
      await p.setVolume(v).catch(() => {});
      return void itx.editReply({ content: `Volume -> ${v}`, flags: 64 });
    }
  }
});

client.login(TOKEN);
