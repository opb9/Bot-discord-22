import express, { Request, Response, NextFunction } from "express";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { openDatabase, withTransaction } from "./src/database/db";
import { seedInitialEcosystem } from "./src/database/seed";
import { resolveAvatarUrl } from "./src/database/avatarGenerator";
import { AppError, logAudit, requireAdmin, requireRegisteredUser, sanitizeId } from "./src/security/auth";
import { registerPlayer } from "./src/services/registrationService";
import {
  depositAdmin,
  getBankAccount,
  getLedger,
  transferBetweenUsers,
  withdrawAdmin,
} from "./src/services/bankService";
import { getActiveLoan, getLoanHistory, issueLoan, repayLoanManually } from "./src/services/loanService";
import {
  addStudyRoom,
  buildUserStudyStats,
  getActiveStudySession,
  getLast7DaysMinutes,
  getMinutesInPeriod,
  getUserStreak,
  joinStudyRoom,
  leaveStudyRoom,
  listStudyRooms,
  recoverInterruptedSessions,
  removeStudyRoom,
  setScreenShareState,
} from "./src/services/studyService";
import {
  cancelChallengeAdmin,
  createChallenge,
  freezeChallengeAdmin,
  getPlayerChallengeRecord,
  listChallengesForViewer,
  respondToChallengeInvite,
  settleChallenge,
  substituteChallengePlayer,
  withdrawFromChallenge,
} from "./src/services/challengeService";
import {
  addCustomProductAdmin,
  buyProduct,
  getPurchaseHistory,
  getUserInventory,
  listProducts,
} from "./src/services/shopService";
import {
  createGuild,
  donateToGuild,
  getGuildDetails,
  inviteToGuild,
  joinGuildDirectly,
  leaveGuild,
  listGuildLeaderboard,
  respondGuildInvite,
  upgradeGuildLevel,
} from "./src/services/guildService";
import {
  assignPositionAdmin,
  assignRankAdmin,
  claimSalaries,
  createPositionAdmin,
  createRankAdmin,
} from "./src/services/economyService";
import { createVerifiedBackup, listBackups } from "./src/services/backupService";
import {
  buyStreakShield,
  claimDailyQuest,
  createSubject,
  deleteSubject,
  getEngagementSummary,
  openDailyFocusChest,
  protectMissedYesterdayWithShield,
  setActiveSubject,
} from "./src/services/studentEngagementService";
import { startDiscordBotIfConfigured } from "./src/discord/bot";
import { PERIODS, levelInfo } from "./src/data/botData";
import { SYSTEM_CONFIG } from "./src/config/settings";

dotenv.config();

const DB_PATH = process.env.STUDY_BOT_DB_PATH || path.resolve(process.cwd(), "data", "study_bot.db");
const db = openDatabase(DB_PATH);
seedInitialEcosystem(db);
const recoveredCount = recoverInterruptedSessions(db, { capAtLastTick: true });
if (recoveredCount > 0) {
  console.log(`[StudyBot] Recovered ${recoveredCount} interrupted study session(s) cleanly.`);
}

function getActorId(req: Request): string {
  return sanitizeId(req.header("x-user-id") || req.query.userId || req.body?.userId || "1");
}

function serializeFullUser(userId: string) {
  const row = db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;

  const xp = Number(row.xp || 0);
  const lv = levelInfo(xp);
  const bank = getBankAccount(db, userId);
  const activeLoan = getActiveLoan(db, userId);
  const loanHistory = getLoanHistory(db, userId);
  const ranks = db
    .prepare(
      "SELECT r.id, r.name, r.emoji FROM user_ranks ur JOIN ranks r ON r.id = ur.rank_id WHERE ur.user_id = ?"
    )
    .all(userId);
  const positions = db
    .prepare(
      "SELECT p.id, p.name, p.salary, p.interval_days as intervalDays, pm.last_claim_ms as lastClaim FROM position_members pm JOIN positions p ON p.id = pm.position_id WHERE pm.user_id = ?"
    )
    .all(userId);
  const guildRow = db
    .prepare(
      "SELECT g.id, g.name, g.emblem, gm.role FROM guild_members gm JOIN guilds g ON g.id = gm.guild_id WHERE gm.user_id = ?"
    )
    .get(userId) as { id: number; name: string; emblem: string; role: string } | undefined;
  const guildInvites = db
    .prepare(
      `SELECT gi.id, gi.guild_id, g.name as guild_name, g.emblem, gi.invited_by, gi.created_at
       FROM guild_invites gi JOIN guilds g ON g.id = gi.guild_id
       WHERE gi.user_id = ? AND gi.status = 'pending'`
    )
    .all(userId);

  return {
    id: String(row.user_id),
    name: String(row.discord_name),
    registered: Number(row.registered) === 1,
    rulesAccepted: Number(row.rules_accepted) === 1,
    isAdmin: Number(row.is_admin) === 1,
    gender: (row.gender as "male" | "female" | null) ?? null,
    job: (row.job as string | null) ?? null,
    avatarUrl: resolveAvatarUrl(
      (row.job as string | null) ?? null,
      (row.gender as "male" | "female" | null) ?? null
    ),
    bg: (row.bg as string | null) ?? null,
    theme: (row.theme as string | null) ?? null,
    quote: (row.quote as string | null) ?? null,
    bio: (row.bio as string | null) ?? null,
    xp,
    level: lv.level,
    xpCur: lv.cur,
    xpNeed: lv.need,
    minutes: Number(row.minutes || 0),
    verifiedMinutes: Number(row.verified_minutes || 0),
    coins: bank?.availableBalance ?? Number(row.coins || 0),
    reservedBalance: bank?.reservedBalance ?? 0,
    accountNumber: bank?.accountNumber ?? null,
    debt: activeLoan?.remainingDebt ?? 0,
    activeLoan,
    loanHistory,
    streak: getUserStreak(db, userId),
    todayMinutes: getMinutesInPeriod(db, userId, "day").regular,
    todayVerifiedMinutes: getMinutesInPeriod(db, userId, "day").verified,
    weekMinutesLast7: getLast7DaysMinutes(db, userId),
    ranks,
    positions,
    guild: guildRow ?? null,
    guildInvites,
    challengeRecord: getPlayerChallengeRecord(db, userId),
    inventory: getUserInventory(db, userId),
    purchaseHistory: getPurchaseHistory(db, userId),
    ledger: getLedger(db, userId, 25),
    engagement: getEngagementSummary(db, userId),
  };
}

async function startServer() {
  const app = express();
  app.use(express.json());

  const avatarsDir = path.resolve(process.cwd(), "avatars");
  if (fs.existsSync(avatarsDir)) {
    app.use("/avatars", express.static(avatarsDir));
  }

  app.get("/api/ping", (_req, res) => {
    res.json({ ok: true, message: "Pong! نظام Study Bot متكامل ويعمل مع SQLite." });
  });

  // Full ecosystem state for active viewer
  app.get("/api/state", (req, res) => {
    const viewerId = getActorId(req);
    const user = serializeFullUser(viewerId);
    const allUsers = (
      db.prepare("SELECT user_id, discord_name, gender, job, xp, minutes, verified_minutes, registered, is_admin FROM users ORDER BY minutes DESC").all() as Array<
        Record<string, unknown>
      >
    ).map((u) => {
      const bank = getBankAccount(db, String(u.user_id));
      return {
        id: String(u.user_id),
        name: String(u.discord_name),
        registered: Number(u.registered) === 1,
        isAdmin: Number(u.is_admin) === 1,
        gender: u.gender,
        job: u.job,
        avatarUrl: resolveAvatarUrl(
          (u.job as string | null) ?? null,
          (u.gender as "male" | "female" | null) ?? null
        ),
        level: levelInfo(Number(u.xp || 0)).level,
        minutes: Number(u.minutes || 0),
        verifiedMinutes: Number(u.verified_minutes || 0),
        coins: bank?.availableBalance ?? 0,
      };
    });

    const positions = (db.prepare("SELECT id, name, salary, interval_days as intervalDays FROM positions ORDER BY name").all() as Array<{
      id: number;
      name: string;
      salary: number;
      intervalDays: number;
    }>).map((p) => ({
      ...p,
      members: db
        .prepare(
          "SELECT u.user_id as id, u.discord_name as name FROM position_members pm JOIN users u ON u.user_id = pm.user_id WHERE pm.position_id = ?"
        )
        .all(p.id),
    }));

    const ranks = db.prepare("SELECT id, name, emoji, description FROM ranks ORDER BY name").all();
    const bgRequests = db
      .prepare(
        "SELECT r.id, r.user_id as userId, u.discord_name as userName, r.idea, r.status, r.created_at as createdAt FROM custom_bg_requests r JOIN users u ON u.user_id = r.user_id ORDER BY r.id DESC LIMIT 20"
      )
      .all();

    res.json({
      user,
      allUsers,
      products: listProducts(db),
      rooms: listStudyRooms(db),
      activeStudySession: getActiveStudySession(db, viewerId),
      challenges: listChallengesForViewer(db, viewerId),
      guilds: listGuildLeaderboard(db),
      positions,
      ranks,
      bgRequests,
      backups: listBackups(),
      auditLogs: db.prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 25").all(),
      config: SYSTEM_CONFIG,
    });
  });

  // Registration
  app.post("/api/register", (req, res) => {
    const userId = getActorId(req);
    const result = registerPlayer(db, {
      userId,
      discordName: req.body?.discordName,
      gender: req.body?.gender,
      acceptRules: Boolean(req.body?.acceptRules),
    });
    res.json({
      ...result,
      message: `✅ تم التسجيل بنجاح! تم إنشاء حسابك البنكي (${result.accountNumber}) ومنحك ${result.bonusGranted} عملة ترحيبية.`,
    });
  });

  // Profile name & bio & equip
  app.post("/api/user/name", (req, res) => {
    const uid = getActorId(req);
    requireRegisteredUser(db, uid);
    const name = String(req.body?.name || "").trim();
    if (name.length < 2 || name.length > 32) {
      throw new AppError("الاسم يجب أن يكون بين 2 و32 حرفًا.", 400);
    }
    db.prepare("UPDATE users SET discord_name = ? WHERE user_id = ?").run(name, uid);
    res.json({ ok: true, message: "✅ تم تحديث الاسم." });
  });

  app.post("/api/profile/bio", (req, res) => {
    const uid = getActorId(req);
    requireRegisteredUser(db, uid);
    const bio = String(req.body?.bio || "").trim().slice(0, 150);
    db.prepare("UPDATE users SET bio = ? WHERE user_id = ?").run(bio || null, uid);
    res.json({ ok: true, message: "✅ تم تحديث البايو." });
  });

  app.post("/api/profile/unequip", (req, res) => {
    const uid = getActorId(req);
    requireRegisteredUser(db, uid);
    const kind = req.body?.kind;
    if (!["bg", "theme", "quote"].includes(kind)) {
      throw new AppError("قسم غير صالح.", 400);
    }
    db.prepare(`UPDATE users SET ${kind} = NULL WHERE user_id = ?`).run(uid);
    res.json({ ok: true, message: "✅ أزلت التفعيل." });
  });

  app.post("/api/profile/custom-bg", (req, res) => {
    const uid = getActorId(req);
    requireRegisteredUser(db, uid);
    const idea = String(req.body?.idea || "").trim().slice(0, 400);
    if (!idea) throw new AppError("يرجى كتابة وصف الخلفية.", 400);
    // Deduct 7000 via Bank atomically
    withTransaction(db, () => {
      const price = 7000;
      const bank = getBankAccount(db, uid);
      if (!bank || bank.availableBalance < price) {
        throw new AppError(`رصيدك البنكي لا يكفي. السعر ${price.toLocaleString()} عملة.`, 400);
      }
      db.prepare("UPDATE bank_accounts SET available_balance = available_balance - ? WHERE user_id = ?").run(
        price,
        uid
      );
      db.prepare("UPDATE users SET coins = coins - ? WHERE user_id = ?").run(price, uid);
      db.prepare(
        "INSERT INTO custom_bg_requests (user_id, idea, status, created_at) VALUES (?, ?, 'pending', ?)"
      ).run(uid, idea, new Date().toISOString());
    });
    res.json({ ok: true, message: "✅ أُرسل طلب الخلفية المخصصة وخُصم 7,000 من البنك." });
  });

  // Study (Regular & Screen-share Verified + Subjects + Pomodoro)
  app.post("/api/study/join", (req, res) => {
    const uid = getActorId(req);
    const session = joinStudyRoom(db, {
      userId: uid,
      roomId: String(req.body?.roomId || ""),
      screenSharing: Boolean(req.body?.screenSharing),
      cameraOn: Boolean(req.body?.cameraOn),
      subjectId: req.body?.subjectId !== undefined ? Number(req.body.subjectId) || null : undefined,
      pomodoroTarget: req.body?.pomodoroTarget ? Number(req.body.pomodoroTarget) : 0,
    });
    res.json({ ok: true, session, message: `📚 دخلت ${session.roomName}.` });
  });

  app.post("/api/study/screen", (req, res) => {
    const uid = getActorId(req);
    const on = Boolean(req.body?.screenSharing);
    const session = setScreenShareState(db, uid, on);
    res.json({
      ok: true,
      session,
      message: on
        ? "🖥️ تم تفعيل مشاركة الشاشة — تُحتسب دقائقك الآن كدراسة موثقة."
        : "⏸️ أُوقفت مشاركة الشاشة — تستمر الدراسة العادية فقط.",
    });
  });

  app.post("/api/study/simulate-minutes", (req, res) => {
    const uid = getActorId(req);
    const mins = Number(req.body?.minutes);
    if (!Number.isInteger(mins) || mins < 1 || mins > 240) {
      throw new AppError("الدقائق يجب أن تكون بين 1 و240.", 400);
    }
    const active = getActiveStudySession(db, uid);
    if (!active) throw new AppError("ادخل غرفة دراسة أولاً.", 400);
    const futureNow = active.lastTickAt + mins * 60_000;
    const result = leaveStudyRoom(db, uid, futureNow, "completed");
    res.json({
      ok: true,
      result,
      message: `✅ سُجلت ${result.regularMinutes} دقيقة دراسة (${result.verifiedMinutes} موثقة بالشاشة)، وكسبت ${result.earned} عملة في البنك${
        result.pomodoroBonus > 0 ? ` + 🍅 ${result.pomodoroBonus} مكافأة بومودورو` : ""
      }${result.repaid > 0 ? ` (خُصم ${result.repaid} لسداد القرض)` : ""}.`,
    });
  });

  app.post("/api/study/leave", (_req, res) => {
    const uid = getActorId(_req);
    const result = leaveStudyRoom(db, uid, Date.now(), "completed");
    res.json({
      ok: true,
      result,
      message: `⏹ غادرت غرفة الدراسة. المسجل: ${result.regularMinutes} د عادية / ${result.verifiedMinutes} د موثقة.`,
    });
  });

  // Bank & Loans
  app.post("/api/bank/transfer", (req, res) => {
    const uid = getActorId(req);
    requireRegisteredUser(db, uid);
    const result = transferBetweenUsers(db, {
      fromUserId: uid,
      toUserId: sanitizeId(req.body?.toUserId),
      amount: Number(req.body?.amount),
      note: req.body?.note ? String(req.body.note) : undefined,
      idempotencyKey: req.body?.idempotencyKey,
    });
    res.json({
      ...result,
      message: `✅ تم تحويل ${result.amount.toLocaleString()} عملة بنجاح${
        result.transferFee > 0
          ? ` (رسوم توازن اقتصادي ${result.transferFee.toLocaleString()} 🪙)`
          : ""
      }.`,
    });
  });

  app.post("/api/loans/issue", (req, res) => {
    const uid = getActorId(req);
    requireRegisteredUser(db, uid);
    const result = issueLoan(db, uid, Number(req.body?.amount), req.body?.idempotencyKey);
    res.json({
      ok: true,
      ...result,
      message: `✅ صُرف قرض ${result.loan.principal.toLocaleString()} في البنك. المستحق مع الرسوم (50%): ${result.loan.totalDue.toLocaleString()}.`,
    });
  });

  app.post("/api/loans/repay", (req, res) => {
    const uid = getActorId(req);
    requireRegisteredUser(db, uid);
    const result = repayLoanManually(db, uid, Number(req.body?.amount), req.body?.idempotencyKey);
    res.json({
      ok: true,
      ...result,
      message: `✅ سُدد ${result.paid.toLocaleString()} من القرض. المتبقي: ${result.remainingDebt.toLocaleString()}.`,
    });
  });

  // Challenges
  app.post("/api/challenges", (req, res) => {
    const uid = getActorId(req);
    const ch = createChallenge(db, {
      creatorId: uid,
      title: String(req.body?.title || "تحدي دراسة"),
      mode: req.body?.mode === "wager" ? "wager" : "free",
      teamSize: Number(req.body?.teamSize || 1) as 1 | 2 | 4 | 8,
      betAmount: Number(req.body?.betAmount || 0),
      durationHours: Number(req.body?.durationHours || 2),
      teamAIds: Array.isArray(req.body?.teamAIds) ? req.body.teamAIds : [uid],
      teamBIds: Array.isArray(req.body?.teamBIds) ? req.body.teamBIds : [],
    });
    res.json({ ok: true, challenge: ch, message: `⚔️ تم إنشاء التحدي ${ch?.id} وإرسال الدعوات.` });
  });

  app.post("/api/challenges/:id/respond", (req, res) => {
    const uid = getActorId(req);
    const decision = req.body?.decision === "decline" ? "decline" : "accept";
    const ch = respondToChallengeInvite(db, req.params.id, uid, decision);
    res.json({
      ok: true,
      challenge: ch,
      message:
        ch?.status === "active"
          ? "🔥 اكتملت الموافقات وحُجزت الرهانات — بدأ التحدي!"
          : decision === "accept"
          ? "✅ قبلت دعوة التحدي."
          : "❌ رفضت دعوة التحدي.",
    });
  });

  app.post("/api/challenges/:id/substitute", (req, res) => {
    const uid = getActorId(req);
    const ch = substituteChallengePlayer(db, {
      challengeId: req.params.id,
      creatorId: uid,
      outgoingUserId: sanitizeId(req.body?.outgoingUserId),
      incomingUserId: sanitizeId(req.body?.incomingUserId),
    });
    res.json({ ok: true, challenge: ch, message: "✅ تم استبدال اللاعب بنجاح." });
  });

  app.post("/api/challenges/:id/withdraw", (req, res) => {
    const uid = getActorId(req);
    const r = withdrawFromChallenge(db, req.params.id, uid);
    res.json({ ok: true, ...r });
  });

  app.post("/api/challenges/:id/settle", (req, res) => {
    const forceNowMs = req.body?.forceComplete ? Date.now() + 8 * 86400 * 1000 : undefined;
    const r = settleChallenge(db, req.params.id, { forceNowMs });
    res.json({
      ok: true,
      ...r,
      message: `🏁 انتهى التحدي! النتيجة: ${
        r.winnerTeam === "tie" ? "تعادل (أُعيدت الرهانات)" : `فوز الفريق ${r.winnerTeam}`
      }`,
    });
  });

  // Shop & Inventory
  app.post("/api/shop/buy", (req, res) => {
    const uid = getActorId(req);
    const r = buyProduct(db, {
      userId: uid,
      productId: String(req.body?.productId || ""),
      variant: req.body?.variant ? String(req.body.variant) : "default",
      idempotencyKey: req.body?.idempotencyKey,
    });
    res.json(r);
  });

  // Guilds
  app.post("/api/guilds", (req, res) => {
    const uid = getActorId(req);
    const g = createGuild(db, {
      leaderId: uid,
      name: String(req.body?.name || ""),
      emblem: req.body?.emblem,
      description: req.body?.description,
    });
    res.json({ ok: true, guild: g, message: `⚔️ تم إنشاء نقابة ${g?.name}!` });
  });

  app.get("/api/guilds/:id", (req, res) => {
    const g = getGuildDetails(db, Number(req.params.id));
    if (!g) throw new AppError("النقابة غير موجودة.", 404);
    res.json(g);
  });

  app.post("/api/guilds/:id/join", (req, res) => {
    const uid = getActorId(req);
    const g = joinGuildDirectly(db, Number(req.params.id), uid);
    res.json({ ok: true, guild: g, message: `✅ انضممت إلى نقابة ${g?.name}.` });
  });

  app.post("/api/guilds/:id/invite", (req, res) => {
    const uid = getActorId(req);
    inviteToGuild(db, {
      guildId: Number(req.params.id),
      actorId: uid,
      targetUserId: sanitizeId(req.body?.targetUserId),
    });
    res.json({ ok: true, message: "✅ تم إرسال دعوة النقابة." });
  });

  app.post("/api/guilds/invites/:inviteId/respond", (req, res) => {
    const uid = getActorId(req);
    const accept = Boolean(req.body?.accept);
    const r = respondGuildInvite(db, Number(req.params.inviteId), uid, accept);
    res.json({ ...r, message: accept ? "✅ تم قبول دعوة النقابة." : "❌ تم رفض الدعوة." });
  });

  app.post("/api/guilds/leave", (req, res) => {
    const uid = getActorId(req);
    leaveGuild(db, uid);
    res.json({ ok: true, message: "✅ غادرت النقابة." });
  });

  app.post("/api/guilds/:id/donate", (req, res) => {
    const uid = getActorId(req);
    const amount = Number(req.body?.amount);
    const g = donateToGuild(db, { guildId: Number(req.params.id), userId: uid, amount });
    res.json({
      ok: true,
      guild: g,
      message: `🏦 تم التبرع بـ ${amount.toLocaleString()} 🪙 لخزينة النقابة!`,
    });
  });

  app.post("/api/guilds/:id/upgrade", (req, res) => {
    const uid = getActorId(req);
    const g = upgradeGuildLevel(db, Number(req.params.id), uid);
    res.json({
      ok: true,
      guild: g,
      message: `⬆️ تمت ترقية النقابة إلى المستوى ${g?.guildLevel}!`,
    });
  });

  // Salaries
  app.post("/api/economy/salary", (req, res) => {
    const uid = getActorId(req);
    const r = claimSalaries(db, uid);
    res.json({ ...r, message: r.lines.join("\n") });
  });

  // Student Engagement: Daily Quests, Mystery Chest, Streak Shields, Study Subjects
  app.post("/api/engagement/quests/:questId/claim", (req, res) => {
    const uid = getActorId(req);
    const r = claimDailyQuest(db, uid, req.params.questId);
    res.json({
      ...r,
      message: `✅ استلمت مكافأة المهمة: +${r.coins} 🪙 (مضاعف السلسلة ${r.multiplier}x) و +${r.xp} XP!`,
    });
  });

  app.post("/api/engagement/chest/open", (req, res) => {
    const uid = getActorId(req);
    const r = openDailyFocusChest(db, uid);
    res.json({
      ...r,
      message: `🎁 صندوق التركيز اليومي: ربحت +${r.coins} 🪙 و +${r.xp} XP${
        r.bonusShield > 0 ? " + 🛡️ درع سلسلة مجاني!" : "!"
      }`,
    });
  });

  app.post("/api/engagement/shields/buy", (req, res) => {
    const uid = getActorId(req);
    const r = buyStreakShield(db, uid);
    res.json({ ...r, message: `🛡️ اشتريت درع حماية السلسلة بنجاح! (الإجمالي: ${r.streakShields})` });
  });

  app.post("/api/engagement/shields/use", (req, res) => {
    const uid = getActorId(req);
    const r = protectMissedYesterdayWithShield(db, uid);
    res.json({ ...r, message: `🛡️ تم تفعيل الدرع وحماية سلسلتك ليوم ${r.savedDay}! السلسلة الآن: ${r.newStreak} يوم.` });
  });

  app.post("/api/engagement/subjects", (req, res) => {
    const uid = getActorId(req);
    const s = createSubject(db, {
      userId: uid,
      name: String(req.body?.name || ""),
      color: req.body?.color ? String(req.body.color) : undefined,
      examDate: req.body?.examDate ? String(req.body.examDate) : undefined,
      targetWeeklyMinutes: req.body?.targetWeeklyMinutes ? Number(req.body.targetWeeklyMinutes) : undefined,
    });
    res.json({ ok: true, subject: s, message: `📘 أُضيفت مادة "${s.name}" وفُعّلت للدراسة.` });
  });

  app.post("/api/engagement/subjects/active", (req, res) => {
    const uid = getActorId(req);
    const subjectId = req.body?.subjectId ? Number(req.body.subjectId) : null;
    const r = setActiveSubject(db, uid, subjectId);
    res.json({ ...r, message: "✅ تم تحديث المادة الدراسية النشطة." });
  });

  app.delete("/api/engagement/subjects/:id", (req, res) => {
    const uid = getActorId(req);
    deleteSubject(db, uid, Number(req.params.id));
    res.json({ ok: true, message: "🗑️ حُذفت المادة." });
  });

  // Stats & Leaderboard
  app.get("/api/stats", (req, res) => {
    const uid = getActorId(req);
    res.json(buildUserStudyStats(db, uid));
  });

  app.get("/api/leaderboard", (req, res) => {
    const period = String(req.query.period || "all");
    if (!PERIODS[period]) throw new AppError("فترة غير صالحة.", 400);
    const allUsers = db
      .prepare("SELECT user_id, discord_name, xp, job, gender FROM users WHERE registered = 1")
      .all() as Array<{ user_id: string; discord_name: string; xp: number; job: string | null; gender: string | null }>;

    const rows = allUsers
      .map((u) => {
        const p = getMinutesInPeriod(db, u.user_id, period);
        return {
          id: u.user_id,
          name: u.discord_name,
          minutes: p.regular,
          verifiedMinutes: p.verified,
          level: levelInfo(u.xp).level,
          job: u.job,
          gender: u.gender,
        };
      })
      .filter((r) => r.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10);

    res.json({ period, label: PERIODS[period], rows });
  });

  // Admin Routes (All guarded by requireAdmin)
  app.post("/api/admin/rooms", (req, res) => {
    const actorId = getActorId(req);
    requireAdmin(db, actorId);
    const room = addStudyRoom(db, String(req.body?.roomId || ""), String(req.body?.name || ""), String(req.body?.description || ""));
    logAudit(db, actorId, "room_add", `إضافة غرفة ${room.name}`, room.roomId);
    res.json({ ok: true, room, message: `✅ تمت إضافة غرفة الدراسة: ${room.name}` });
  });

  app.delete("/api/admin/rooms/:roomId", (req, res) => {
    const actorId = getActorId(req);
    requireAdmin(db, actorId);
    removeStudyRoom(db, req.params.roomId);
    logAudit(db, actorId, "room_remove", "إزالة غرفة دراسة", req.params.roomId);
    res.json({ ok: true, message: "🗑️ تم إزالة الغرفة." });
  });

  app.post("/api/admin/bank/adjust", (req, res) => {
    const actorId = getActorId(req);
    requireAdmin(db, actorId);
    const targetId = sanitizeId(req.body?.targetUserId);
    const amount = Number(req.body?.amount);
    if (!Number.isInteger(amount) || amount === 0) {
      throw new AppError("أدخل مبلغًا صحيحًا غير صفر.", 400);
    }
    if (amount > 0) {
      depositAdmin(db, { userId: targetId, amount, description: `إيداع إداري من ${actorId}` });
    } else {
      withdrawAdmin(db, { userId: targetId, amount: Math.abs(amount), description: `سحب إداري من ${actorId}` });
    }
    logAudit(db, actorId, "bank_adjust", `amount=${amount}`, targetId);
    res.json({ ok: true, message: `✅ تم تعديل رصيد البنك (${amount > 0 ? "+" : ""}${amount.toLocaleString()}).` });
  });

  app.post("/api/admin/challenges/:id/freeze", (req, res) => {
    const actorId = getActorId(req);
    freezeChallengeAdmin(db, actorId, req.params.id, String(req.body?.reason || "مراجعة السجلات"));
    res.json({ ok: true, message: "❄️ تم تجميد التحدي للمراجعة الإدارية." });
  });

  app.post("/api/admin/challenges/:id/cancel", (req, res) => {
    const actorId = getActorId(req);
    cancelChallengeAdmin(db, actorId, req.params.id, String(req.body?.reason || ""));
    res.json({ ok: true, message: "🛑 تم إلغاء التحدي وإعادة الرهانات كاملة." });
  });

  app.post("/api/admin/products", (req, res) => {
    const actorId = getActorId(req);
    const r = addCustomProductAdmin(db, actorId, req.body);
    res.json({ ...r, message: "✅ تمت إضافة المنتج/الشخصية للمتجر." });
  });

  app.post("/api/admin/positions", (req, res) => {
    const actorId = getActorId(req);
    const p = createPositionAdmin(db, actorId, String(req.body?.name || ""), Number(req.body?.salary), Number(req.body?.intervalDays ?? 7));
    res.json({ ok: true, position: p, message: `✅ أُنشئت الوظيفة: ${p.name}` });
  });

  app.post("/api/admin/positions/:id/assign", (req, res) => {
    const actorId = getActorId(req);
    assignPositionAdmin(db, actorId, Number(req.params.id), sanitizeId(req.body?.targetUserId), req.body?.action === "take" ? "take" : "give");
    res.json({ ok: true, message: "✅ تم تحديث تعيين الوظيفة." });
  });

  app.post("/api/admin/ranks", (req, res) => {
    const actorId = getActorId(req);
    const r = createRankAdmin(db, actorId, String(req.body?.name || ""), String(req.body?.emoji || "🎖️"));
    res.json({ ok: true, rank: r, message: `✅ أُنشئت الرتبة: ${r.emoji} ${r.name}` });
  });

  app.post("/api/admin/ranks/:id/assign", (req, res) => {
    const actorId = getActorId(req);
    assignRankAdmin(db, actorId, Number(req.params.id), sanitizeId(req.body?.targetUserId), req.body?.action === "take" ? "take" : "give");
    res.json({ ok: true, message: "✅ تم تحديث الرتبة." });
  });

  app.post("/api/admin/backups", (req, res) => {
    const actorId = getActorId(req);
    requireAdmin(db, actorId);
    const backup = createVerifiedBackup(db);
    logAudit(db, actorId, "backup_create", `نسخة احتياطية ${backup.filename}`);
    res.json({ ok: true, backup, message: `📦 تم إنشاء نسخة احتياطية سليمة: ${backup.filename}` });
  });

  // Centralized error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("[StudyBot Error]", err);
    return res.status(500).json({ error: "حدث خطأ داخلي في الخادم." });
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Study Bot Ecosystem listening on http://0.0.0.0:${PORT}`);
    startDiscordBotIfConfigured(db).catch((err) => {
      console.error("[Discord Startup Error]", err);
    });
  });
}

startServer();
