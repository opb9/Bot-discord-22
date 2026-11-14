import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { resolveAvatarFsPath } from "../database/avatarGenerator";
import { registerPlayer } from "../services/registrationService";
import {
  addStudyRoom,
  getActiveStudySession,
  getMinutesInPeriod,
  getUserStreak,
  joinStudyRoom,
  leaveStudyRoom,
  listStudyRooms,
  removeStudyRoom,
  setScreenShareState,
  tickActiveStudySessions,
} from "../services/studyService";
import { getBankAccount } from "../services/bankService";
import { claimSalaries } from "../services/economyService";
import {
  claimDailyQuest,
  getEngagementSummary,
  openDailyFocusChest,
} from "../services/studentEngagementService";
import { BUILTIN_JOBS, GenderKey, PERIODS, levelInfo } from "../data/botData";
import { AppError } from "../security/auth";

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} س و${m} د` : `${m} د`;
}

export interface DiscordBotHandle {
  client: Client;
  stop: () => Promise<void>;
}

const SLASH_COMMANDS = [
  new SlashCommandBuilder()
    .setName("register")
    .setDescription("التسجيل الإلزامي في Study Bot وفتح الحساب البنكي"),
  new SlashCommandBuilder()
    .setName("profile")
    .setDescription("عرض بطاقتك وإحصائياتك البنكية والدراسية"),
  new SlashCommandBuilder()
    .setName("quests")
    .setDescription("عرض المهام اليومية ومضاعف السلسلة وصندوق التركيز"),
  new SlashCommandBuilder()
    .setName("chest")
    .setDescription("فتح صندوق التركيز اليومي بعد إكمال 30 دقيقة دراسة"),
  new SlashCommandBuilder()
    .setName("bank")
    .setDescription("عرض حسابك البنكي واستلام الراتب المستحق"),
  new SlashCommandBuilder()
    .setName("study_rooms")
    .setDescription("عرض غرف الدراسة الصوتية المعتمدة في السيرفر"),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("عرض لوحة متصدري الدراسة")
    .addStringOption((opt) =>
      opt
        .setName("period")
        .setDescription("الفترة الزمنية")
        .addChoices(
          { name: "اليوم", value: "day" },
          { name: "الأسبوع", value: "week" },
          { name: "الشهر", value: "month" },
          { name: "الإجمالي", value: "all" }
        )
    ),
  new SlashCommandBuilder()
    .setName("admin_room_add")
    .setDescription("اعتماد غرفة صوتية للدراسة (للإدارة فقط)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((opt) =>
      opt.setName("channel").setDescription("القناة الصوتية المعتمدة").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("admin_room_remove")
    .setDescription("إلغاء اعتماد غرفة صوتية (للإدارة فقط)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((opt) =>
      opt.setName("channel").setDescription("القناة الصوتية").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("دليل أوامر وقواعد الدراسة في Study Bot"),
].map((c) => c.toJSON());

function getFriendlyError(err: unknown): string {
  if (err instanceof AppError) return `⚠️ ${err.message}`;
  return "⚠️ تعذر تنفيذ الطلب حالياً، حاول مرة أخرى.";
}

export async function startDiscordBotIfConfigured(
  db: DatabaseSync
): Promise<DiscordBotHandle | null> {
  const token = process.env.DISCORD_TOKEN?.trim();
  if (!token) {
    console.log("[Discord] DISCORD_TOKEN غير مضبوط — يعمل الخادم في وضع الويب فقط.");
    return null;
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  const approvedSet = () =>
    new Set(listStudyRooms(db).map((r) => r.roomId));

  // Track real Discord Voice + Screen Share (`streaming`) state
  client.on("voiceStateUpdate", (oldState, newState) => {
    try {
      const userId = newState.id || oldState.id;
      if (!userId || newState.member?.user.bot || oldState.member?.user.bot) return;

      const userRow = db
        .prepare("SELECT registered FROM users WHERE user_id = ?")
        .get(userId) as { registered: number } | undefined;
      if (!userRow || userRow.registered !== 1) return;

      const approved = approvedSet();
      const oldApproved = oldState.channelId ? approved.has(oldState.channelId) : false;
      const newApproved = newState.channelId ? approved.has(newState.channelId) : false;
      const screenOn = Boolean(newState.streaming);
      const camOn = Boolean(newState.selfVideo);

      if (!oldApproved && newApproved && newState.channelId) {
        joinStudyRoom(db, {
          userId,
          roomId: newState.channelId,
          screenSharing: screenOn,
          cameraOn: camOn,
        });
      } else if (oldApproved && newApproved && oldState.channelId !== newState.channelId && newState.channelId) {
        joinStudyRoom(db, {
          userId,
          roomId: newState.channelId,
          screenSharing: screenOn,
          cameraOn: camOn,
        });
      } else if (oldApproved && newApproved && Boolean(oldState.streaming) !== screenOn) {
        if (getActiveStudySession(db, userId)) {
          setScreenShareState(db, userId, screenOn);
        }
      } else if (oldApproved && !newApproved) {
        if (getActiveStudySession(db, userId)) {
          leaveStudyRoom(db, userId, Date.now(), "completed");
        }
      }
    } catch (err) {
      console.error("[Discord voiceStateUpdate Error]", err);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isButton()) {
        const uid = interaction.user.id;
        if (interaction.customId === "reg_male" || interaction.customId === "reg_female") {
          const gender = interaction.customId === "reg_male" ? "male" : "female";
          const res = registerPlayer(db, {
            userId: uid,
            discordName: interaction.user.globalName || interaction.user.username,
            gender,
            acceptRules: true,
          });
          await interaction.reply({
            ephemeral: true,
            content: `✅ أهلاً بك في Study Bot! فُتح حسابك البنكي **${res.accountNumber}** ومنحت **${res.bonusGranted} 🪙** مكافأة ترحيبية.`,
          });
          return;
        }

        if (interaction.customId.startsWith("quest_claim:")) {
          const questId = interaction.customId.split(":")[1];
          const r = claimDailyQuest(db, uid, questId);
          await interaction.reply({
            ephemeral: true,
            content: `✅ تم استلام مكافأة المهمة! (+${r.coins} 🪙 بمضاعف ${r.multiplier}x و +${r.xp} XP)`,
          });
          return;
        }

        if (interaction.customId === "open_daily_chest") {
          const r = openDailyFocusChest(db, uid);
          await interaction.reply({
            ephemeral: true,
            content: `🎁 فتحت صندوق التركيز اليومي: **+${r.coins} 🪙** و **+${r.xp} XP**${
              r.bonusShield > 0 ? " + 🛡️ درع حماية سلسلة مجاني!" : ""
            }`,
          });
          return;
        }

        if (interaction.customId === "claim_salary") {
          const r = claimSalaries(db, uid);
          await interaction.reply({ ephemeral: true, content: r.lines.join("\n") });
          return;
        }
        return;
      }

      if (!interaction.isChatInputCommand()) return;
      const uid = interaction.user.id;

      if (interaction.commandName === "register") {
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("📚 التسجيل الإلزامي في Study Bot")
          .setDescription(
            "بالضغط على جنسك أدناه، توافق على قوانين المجتمع والعدالة الدراسية ويُنشأ حسابك البنكي فوراً."
          );
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("reg_male").setLabel("👨 ذكر — أوافق وأسجل").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("reg_female").setLabel("👩 أنثى — أوافق وأسجل").setStyle(ButtonStyle.Success)
        );
        await interaction.reply({ ephemeral: true, embeds: [embed], components: [row] });
        return;
      }

      if (interaction.commandName === "profile") {
        const u = db.prepare("SELECT * FROM users WHERE user_id = ?").get(uid) as Record<string, unknown> | undefined;
        if (!u || Number(u.registered) !== 1) {
          await interaction.reply({ ephemeral: true, content: "⛔ سجّل أولاً باستخدام `/register`." });
          return;
        }
        const lv = levelInfo(Number(u.xp || 0));
        const bank = getBankAccount(db, uid);
        const streak = getUserStreak(db, uid);
        const eng = getEngagementSummary(db, uid);
        const jobId = (u.job as string | null) ?? null;
        const gender = (u.gender as GenderKey | null) ?? null;
        const jobMeta = jobId ? BUILTIN_JOBS[jobId] : null;
        const jobLabel = jobMeta
          ? `${jobMeta.emoji} ${gender === "female" ? jobMeta.female : jobMeta.male}`
          : "بدون مهنة بعد";

        const avatarFsPath = resolveAvatarFsPath(jobId, gender);
        const files: AttachmentBuilder[] = [];

        const embed = new EmbedBuilder()
          .setColor(0x568bff)
          .setTitle(`🪪 بطاقة ${String(u.discord_name)}`)
          .setDescription(`**المهنة:** ${jobLabel}`)
          .addFields(
            { name: "🏦 البنك المتاح", value: `${(bank?.availableBalance ?? 0).toLocaleString()} 🪙`, inline: true },
            { name: "⭐ المستوى", value: `Lv.${lv.level} (${lv.cur}/${lv.need} XP)`, inline: true },
            { name: "🔥 السلسلة", value: `${streak} يوم (${eng.streakMultiplier}x)`, inline: true },
            { name: "📚 إجمالي الدراسة", value: formatMinutes(Number(u.minutes || 0)), inline: true },
            { name: "🖥️ الموثقة بالشاشة", value: formatMinutes(Number(u.verified_minutes || 0)), inline: true },
            { name: "🛡️ دروع السلسلة", value: `${eng.streakShields}/${eng.maxStreakShields}`, inline: true }
          );

        if (avatarFsPath) {
          const fileName = path.basename(avatarFsPath);
          files.push(new AttachmentBuilder(avatarFsPath, { name: fileName }));
          embed.setThumbnail(`attachment://${fileName}`);
        }

        await interaction.reply({ embeds: [embed], files });
        return;
      }

      if (interaction.commandName === "quests") {
        const eng = getEngagementSummary(db, uid);
        const lines = eng.quests.map(
          (q) =>
            `${q.claimed ? "✅" : q.completed ? "🎁" : "⏳"} **${q.title}** — (${q.progressMinutes}/${q.targetMinutes} د) • جائزة: ${q.finalCoins} 🪙`
        );
        const embed = new EmbedBuilder()
          .setColor(0xffd166)
          .setTitle(`🎯 المهام اليومية (مضاعف السلسلة ${eng.streakMultiplier}x)`)
          .setDescription(lines.join("\n"));

        const claimable = eng.quests.filter((q) => q.completed && !q.claimed).slice(0, 4);
        const row = new ActionRowBuilder<ButtonBuilder>();
        for (const q of claimable) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`quest_claim:${q.id}`)
              .setLabel(`استلام ${q.title.slice(0, 18)}`)
              .setStyle(ButtonStyle.Success)
          );
        }
        if (eng.dailyChest.unlocked && !eng.dailyChest.claimed) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId("open_daily_chest")
              .setLabel("🎁 فتح الصندوق اليومي")
              .setStyle(ButtonStyle.Primary)
          );
        }
        await interaction.reply({
          ephemeral: true,
          embeds: [embed],
          components: row.components.length > 0 ? [row] : [],
        });
        return;
      }

      if (interaction.commandName === "chest") {
        const r = openDailyFocusChest(db, uid);
        await interaction.reply({
          ephemeral: true,
          content: `🎁 فتحت صندوق التركيز اليومي: **+${r.coins} 🪙** و **+${r.xp} XP**${
            r.bonusShield > 0 ? " + 🛡️ درع حماية!" : ""
          }`,
        });
        return;
      }

      if (interaction.commandName === "bank") {
        const bank = getBankAccount(db, uid);
        if (!bank) {
          await interaction.reply({ ephemeral: true, content: "⛔ سجّل أولاً عبر `/register`." });
          return;
        }
        const embed = new EmbedBuilder()
          .setColor(0x10b981)
          .setTitle(`🏦 الحساب البنكي ${bank.accountNumber}`)
          .addFields(
            { name: "الرصيد المتاح", value: `${bank.availableBalance.toLocaleString()} 🪙`, inline: true },
            { name: "المحجوز للتحديات", value: `${bank.reservedBalance.toLocaleString()} 🪙`, inline: true }
          );
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("claim_salary").setLabel("💵 استلام الرواتب المستحقة").setStyle(ButtonStyle.Success)
        );
        await interaction.reply({ ephemeral: true, embeds: [embed], components: [row] });
        return;
      }

      if (interaction.commandName === "study_rooms") {
        const rooms = listStudyRooms(db);
        const desc =
          rooms.length === 0
            ? "لا توجد غرف صوتية معتمدة بعد. يمكن للإدارة إضافتها عبر `/admin_room_add`."
            : rooms.map((r) => `• <#${r.roomId}> (**${r.name}**)`).join("\n");
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🎙️ غرف الدراسة المعتمدة").setDescription(desc)],
        });
        return;
      }

      if (interaction.commandName === "leaderboard") {
        const period = interaction.options.getString("period") || "all";
        const users = db
          .prepare("SELECT user_id, discord_name, xp FROM users WHERE registered = 1")
          .all() as Array<{ user_id: string; discord_name: string; xp: number }>;
        const top = users
          .map((u) => ({ name: u.discord_name, ...getMinutesInPeriod(db, u.user_id, period) }))
          .filter((r) => r.regular > 0)
          .sort((a, b) => b.regular - a.regular)
          .slice(0, 10);
        const lines = top.length
          ? top.map((r, i) => `**#${i + 1}** ${r.name} — ${formatMinutes(r.regular)} (🖥️ ${r.verified}د)`).join("\n")
          : "لا توجد دقائق مسجلة في هذه الفترة بعد.";
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xffd166)
              .setTitle(`🏆 لوحة المتصدرين (${PERIODS[period] || "الإجمالي"})`)
              .setDescription(lines),
          ],
        });
        return;
      }

      if (interaction.commandName === "admin_room_add") {
        const ch = interaction.options.getChannel("channel", true);
        addStudyRoom(db, ch.id, ch.name || `غرفة ${ch.id}`, "معتمدة من Discord");
        await interaction.reply({ ephemeral: true, content: `✅ تم اعتماد غرفة الدراسة <#${ch.id}>.` });
        return;
      }

      if (interaction.commandName === "admin_room_remove") {
        const ch = interaction.options.getChannel("channel", true);
        removeStudyRoom(db, ch.id);
        await interaction.reply({ ephemeral: true, content: `🗑️ تم إلغاء اعتماد <#${ch.id}>.` });
        return;
      }

      if (interaction.commandName === "help") {
        await interaction.reply({
          ephemeral: true,
          content:
            "📚 **Study Bot**:\n• `/register` التسجيل وفتح الحساب البنكي\n• `/profile` البطاقة والمستوى\n• `/quests` المهام اليومية ومضاعف السلسلة\n• `/chest` صندوق التركيز اليومي\n• `/bank` البنك والرواتب\n• `/study_rooms` الرومات المعتمدة (مشاركة الشاشة شرط الدراسة الموثقة!)",
        });
      }
    } catch (err) {
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ ephemeral: true, content: getFriendlyError(err) });
      }
    }
  });

  let ticker: NodeJS.Timeout | null = null;

  client.once("clientReady", async (c) => {
    console.log(`[Discord] متصل بنجاح باسم: ${c.user.tag}`);
    try {
      const rest = new REST({ version: "10" }).setToken(token);
      const guildId = process.env.DISCORD_GUILD_ID?.trim();
      if (guildId) {
        await rest.put(Routes.applicationGuildCommands(c.user.id, guildId), { body: SLASH_COMMANDS });
      } else {
        await rest.put(Routes.applicationCommands(c.user.id), { body: SLASH_COMMANDS });
      }
      console.log("[Discord] تم تسجيل أوامر Slash التفاعلية بنجاح.");
    } catch (err) {
      console.error("[Discord] تعذر تسجيل أوامر Slash:", err);
    }
    ticker = setInterval(() => {
      try {
        tickActiveStudySessions(db);
      } catch (err) {
        console.error("[Discord Study Ticker Error]", err);
      }
    }, 60_000);
  });

  await client.login(token);

  return {
    client,
    stop: async () => {
      if (ticker) clearInterval(ticker);
      client.destroy();
    },
  };
}
