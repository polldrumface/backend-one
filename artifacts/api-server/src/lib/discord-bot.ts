import { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events } from "discord.js";
import { logger } from "./logger.js";
import { db, approvedUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type ApprovalStatus = "pending" | "approved" | "rejected";

interface PendingRequest {
  userId: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  resolve: (status: ApprovalStatus) => void;
  messageId?: string;
  channelId?: string;
  expiresAt: number;
}

const pendingRequests = new Map<string, PendingRequest>();

let client: Client | null = null;

export function getDiscordClient(): Client {
  if (!client) {
    client = new Client({ intents: [GatewayIntentBits.Guilds] });

    client.once(Events.ClientReady, async (c) => {
      logger.info({ tag: c.user.tag }, "Discord bot ready");
      try {
        await c.application.commands.create({
          name: "revoke",
          description: "Забрать доступ к сайту у пользователя",
          options: [{
            name: "user",
            description: "Пользователь, у которого нужно забрать доступ",
            type: 6, // USER type
            required: true
          }]
        });
      } catch (err) {
        logger.error({ err }, "Failed to register commands");
      }
    });

    client.on(Events.InteractionCreate, async (interaction) => {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "revoke") {
          const targetUser = interaction.options.getUser("user");
          if (!targetUser) return;
          try {
            await db.update(approvedUsersTable)
              .set({ approved: false })
              .where(eq(approvedUsersTable.discordId, targetUser.id));
            await interaction.reply({ content: `✅ Доступ для пользователя ${targetUser.tag} успешно отозван.`, ephemeral: true });
          } catch (err) {
            logger.error({ err }, "Failed to revoke user");
            await interaction.reply({ content: "❌ Ошибка при отзыве доступа.", ephemeral: true });
          }
        }
        return;
      }

      if (!interaction.isButton()) return;

      const [action, token] = interaction.customId.split(":");
      if (action !== "approve" && action !== "reject") return;

      const request = pendingRequests.get(token);
      if (!request) {
        await interaction.reply({ content: "Этот запрос уже обработан или истёк.", ephemeral: true });
        return;
      }

      const status: ApprovalStatus = action === "approve" ? "approved" : "rejected";
      request.resolve(status);
      pendingRequests.delete(token);

      const statusText = status === "approved" ? "Доступ выдан" : "Доступ отклонён";
      const color = status === "approved" ? 0x57f287 : 0xed4245;

      const embed = new EmbedBuilder()
        .setTitle(statusText)
        .setDescription(`Запрос от **${request.username}** обработан.`)
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: `Обработано: ${interaction.user.tag}` });

      await interaction.update({ embeds: [embed], components: [] });
    });

    const token = process.env.DISCORD_BOT_TOKEN;
    if (token) {
      client.login(token).catch((err) => {
        logger.error({ err }, "Failed to login Discord bot");
      });
    } else {
      logger.warn("DISCORD_BOT_TOKEN not set, bot disabled");
    }
  }
  return client;
}

export async function sendApprovalRequest(
  token: string,
  user: { id: string; username: string; discriminator: string; avatar: string | null }
): Promise<ApprovalStatus> {
  const channelId = process.env.DISCORD_APPROVAL_CHANNEL_ID;
  if (!channelId) {
    logger.error("DISCORD_APPROVAL_CHANNEL_ID not set");
    return "rejected";
  }

  const discordClient = getDiscordClient();

  return new Promise<ApprovalStatus>(async (resolve) => {
    const expiresAt = Date.now() + 10 * 60 * 1000;

    pendingRequests.set(token, {
      userId: user.id,
      username: user.username,
      discriminator: user.discriminator,
      avatar: user.avatar,
      resolve: (status) => resolve(status),
      expiresAt,
    });

    setTimeout(() => {
      const req = pendingRequests.get(token);
      if (req) {
        pendingRequests.delete(token);
        req.resolve("rejected");
      }
    }, 10 * 60 * 1000);

    try {
      await new Promise<void>((r) => {
        if (discordClient.isReady()) { r(); return; }
        discordClient.once(Events.ClientReady, () => r());
        setTimeout(() => r(), 8000);
      });

      const channel = await discordClient.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        logger.error({ channelId }, "Channel not found or not text-based");
        pendingRequests.delete(token);
        resolve("rejected");
        return;
      }

      const avatarUrl = user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`;

      const embed = new EmbedBuilder()
        .setTitle("Запрос на доступ")
        .setDescription(`Пользователь **${user.username}** хочет войти на сайт судебной коллегии Winslow.`)
        .addFields(
          { name: "Discord ID", value: user.id, inline: true },
          { name: "Пользователь", value: `${user.username}`, inline: true }
        )
        .setThumbnail(avatarUrl)
        .setColor(0xfaa61a)
        .setTimestamp()
        .setFooter({ text: "Запрос истечёт через 10 минут" });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`approve:${token}`)
          .setLabel("Дать доступ")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`reject:${token}`)
          .setLabel("Отклонить")
          .setStyle(ButtonStyle.Danger)
      );

      const msg = await (channel as any).send({ embeds: [embed], components: [row] });
      const req = pendingRequests.get(token);
      if (req) {
        req.messageId = msg.id;
        req.channelId = channelId;
      }

      logger.info({ token, userId: user.id }, "Approval request sent to Discord");
    } catch (err) {
      logger.error({ err }, "Failed to send approval request");
      pendingRequests.delete(token);
      resolve("rejected");
    }
  });
}

export function getPendingStatus(token: string): ApprovalStatus | null {
  const req = pendingRequests.get(token);
  if (!req) return null;
  if (Date.now() > req.expiresAt) {
    pendingRequests.delete(token);
    return "rejected";
  }
  return "pending";
}
