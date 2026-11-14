import { DatabaseSync } from "node:sqlite";
import { SYSTEM_CONFIG } from "../config/settings";
import { withTransaction } from "../database/db";
import { AppError, requireRegisteredUser } from "../security/auth";
import { debitBankInTx } from "./bankService";
import { levelInfo } from "../data/botData";

export function createGuild(
  db: DatabaseSync,
  params: { leaderId: string; name: string; emblem?: string; description?: string }
) {
  const name = params.name.trim();
  const emblem = (params.emblem || "⚔️").trim().slice(0, 8) || "⚔️";
  const description = (params.description || "").trim().slice(0, 200);
  if (name.length < 2 || name.length > 32) {
    throw new AppError("اسم النقابة يجب أن يكون بين 2 و32 حرفًا.", 400);
  }

  return withTransaction(db, () => {
    const user = requireRegisteredUser(db, params.leaderId) as { xp: number };
    const lv = levelInfo(Number(user.xp)).level;
    if (lv < SYSTEM_CONFIG.GUILD_CREATE_MIN_LEVEL) {
      throw new AppError(
        `إنشاء نقابة جديدة يتطلب المستوى ${SYSTEM_CONFIG.GUILD_CREATE_MIN_LEVEL} أو أعلى (مستواك الحالي: ${lv}). يمكنك الانضمام لنقابة قائمة قبل ذلك.`,
        403
      );
    }

    const inGuild = db
      .prepare("SELECT guild_id FROM guild_members WHERE user_id = ?")
      .get(params.leaderId);
    if (inGuild) {
      throw new AppError("أنت عضو في نقابة حالياً. غادرها قبل إنشاء نقابة جديدة.", 400);
    }

    const dup = db.prepare("SELECT id FROM guilds WHERE name = ?").get(name);
    if (dup) {
      throw new AppError("يوجد نقابة بهذا الاسم مسبقاً.", 409);
    }

    const now = new Date().toISOString();
    const res = db
      .prepare(
        "INSERT INTO guilds (name, emblem, description, leader_id, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(name, emblem, description, params.leaderId, now);
    const guildId = Number(res.lastInsertRowid);

    db.prepare(
      "INSERT INTO guild_members (guild_id, user_id, role, joined_at) VALUES (?, ?, 'leader', ?)"
    ).run(guildId, params.leaderId, now);

    db.prepare(
      "INSERT INTO guild_activity_logs (guild_id, actor_id, action, details, created_at) VALUES (?, ?, 'create', ?, ?)"
    ).run(guildId, params.leaderId, `تم إنشاء النقابة ${emblem} ${name}`, now);

    return getGuildDetails(db, guildId);
  });
}

export function inviteToGuild(
  db: DatabaseSync,
  params: { guildId: number; actorId: string; targetUserId: string }
) {
  return withTransaction(db, () => {
    requireRegisteredUser(db, params.targetUserId);
    const actor = db
      .prepare("SELECT role FROM guild_members WHERE guild_id = ? AND user_id = ?")
      .get(params.guildId, params.actorId) as { role: string } | undefined;
    if (!actor || (actor.role !== "leader" && actor.role !== "officer")) {
      throw new AppError("فقط القائد أو المشرف يمكنهم إرسال دعوات النقابة.", 403);
    }

    const targetInGuild = db
      .prepare("SELECT guild_id FROM guild_members WHERE user_id = ?")
      .get(params.targetUserId);
    if (targetInGuild) {
      throw new AppError("اللاعب منضم لنقابة بالفعل.", 400);
    }

    const memberCount = (
      db
        .prepare("SELECT COUNT(*) as c FROM guild_members WHERE guild_id = ?")
        .get(params.guildId) as { c: number }
    ).c;
    if (memberCount >= SYSTEM_CONFIG.GUILD_MAX_MEMBERS) {
      throw new AppError("اكتمل الحد الأقصى لأعضاء النقابة.", 400);
    }

    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO guild_invites (guild_id, user_id, invited_by, status, created_at)
       VALUES (?, ?, ?, 'pending', ?)`
    ).run(params.guildId, params.targetUserId, params.actorId, now);

    db.prepare(
      "INSERT INTO guild_activity_logs (guild_id, actor_id, action, details, created_at) VALUES (?, ?, 'invite', ?, ?)"
    ).run(params.guildId, params.actorId, `دعوة العضو ${params.targetUserId}`, now);

    return { ok: true };
  });
}

export function respondGuildInvite(
  db: DatabaseSync,
  inviteId: number,
  userId: string,
  accept: boolean
) {
  return withTransaction(db, () => {
    requireRegisteredUser(db, userId);
    const inv = db
      .prepare("SELECT * FROM guild_invites WHERE id = ? AND user_id = ? AND status = 'pending'")
      .get(inviteId, userId) as { id: number; guild_id: number } | undefined;
    if (!inv) {
      throw new AppError("الدعوة غير موجودة أو تم الرد عليها.", 404);
    }

    const now = new Date().toISOString();
    if (!accept) {
      db.prepare("UPDATE guild_invites SET status = 'rejected' WHERE id = ?").run(inv.id);
      return { ok: true, accepted: false };
    }

    const already = db
      .prepare("SELECT guild_id FROM guild_members WHERE user_id = ?")
      .get(userId);
    if (already) {
      throw new AppError("أنت عضو في نقابة حالياً.", 400);
    }

    db.prepare("UPDATE guild_invites SET status = 'accepted' WHERE id = ?").run(inv.id);
    db.prepare(
      "INSERT INTO guild_members (guild_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)"
    ).run(inv.guild_id, userId, now);
    db.prepare(
      "INSERT INTO guild_activity_logs (guild_id, actor_id, action, details, created_at) VALUES (?, ?, 'join', ?, ?)"
    ).run(inv.guild_id, userId, `انضم اللاعب ${userId} إلى النقابة`, now);

    return { ok: true, accepted: true, guildId: inv.guild_id };
  });
}

export function joinGuildDirectly(db: DatabaseSync, guildId: number, userId: string) {
  return withTransaction(db, () => {
    requireRegisteredUser(db, userId);
    const guild = db.prepare("SELECT id FROM guilds WHERE id = ?").get(guildId);
    if (!guild) throw new AppError("النقابة غير موجودة.", 404);

    const existing = db.prepare("SELECT guild_id FROM guild_members WHERE user_id = ?").get(userId);
    if (existing) throw new AppError("أنت منضم لنقابة بالفعل. غادرها أولاً.", 400);

    const count = (
      db.prepare("SELECT COUNT(*) as c FROM guild_members WHERE guild_id = ?").get(guildId) as {
        c: number;
      }
    ).c;
    if (count >= SYSTEM_CONFIG.GUILD_MAX_MEMBERS) {
      throw new AppError("النقابة ممتلئة.", 400);
    }

    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO guild_members (guild_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)"
    ).run(guildId, userId, now);
    db.prepare(
      "INSERT INTO guild_activity_logs (guild_id, actor_id, action, details, created_at) VALUES (?, ?, 'join', ?, ?)"
    ).run(guildId, userId, `انضم ${userId} إلى النقابة`, now);
    return getGuildDetails(db, guildId);
  });
}

export function leaveGuild(db: DatabaseSync, userId: string) {
  return withTransaction(db, () => {
    const membership = db
      .prepare("SELECT guild_id, role FROM guild_members WHERE user_id = ?")
      .get(userId) as { guild_id: number; role: string } | undefined;
    if (!membership) throw new AppError("أنت لست عضواً في أي نقابة.", 400);

    const now = new Date().toISOString();
    if (membership.role === "leader") {
      const other = db
        .prepare(
          "SELECT user_id FROM guild_members WHERE guild_id = ? AND user_id != ? ORDER BY joined_at ASC LIMIT 1"
        )
        .get(membership.guild_id, userId) as { user_id: string } | undefined;
      if (other) {
        db.prepare("UPDATE guild_members SET role = 'leader' WHERE user_id = ?").run(other.user_id);
        db.prepare("UPDATE guilds SET leader_id = ? WHERE id = ?").run(
          other.user_id,
          membership.guild_id
        );
      } else {
        db.prepare("DELETE FROM guild_members WHERE user_id = ?").run(userId);
        db.prepare("DELETE FROM guild_invites WHERE guild_id = ?").run(membership.guild_id);
        db.prepare("DELETE FROM guild_activity_logs WHERE guild_id = ?").run(membership.guild_id);
        db.prepare("DELETE FROM guilds WHERE id = ?").run(membership.guild_id);
        return { ok: true, disbanded: true };
      }
    }

    db.prepare("DELETE FROM guild_members WHERE user_id = ?").run(userId);
    db.prepare(
      "INSERT INTO guild_activity_logs (guild_id, actor_id, action, details, created_at) VALUES (?, ?, 'leave', ?, ?)"
    ).run(membership.guild_id, userId, `غادر العضو ${userId} النقابة`, now);
    return { ok: true, disbanded: false };
  });
}

export function donateToGuild(
  db: DatabaseSync,
  params: { guildId: number; userId: string; amount: number }
) {
  if (!Number.isInteger(params.amount) || params.amount < 100) {
    throw new AppError("الحد الأدنى للتبرع لخزينة النقابة هو 100 عملة.", 400);
  }
  return withTransaction(db, () => {
    requireRegisteredUser(db, params.userId);
    const membership = db
      .prepare("SELECT guild_id FROM guild_members WHERE user_id = ? AND guild_id = ?")
      .get(params.userId, params.guildId);
    if (!membership) {
      throw new AppError("يجب أن تكون عضواً في النقابة للتبرع لخزينتها.", 403);
    }

    debitBankInTx(db, {
      userId: params.userId,
      amount: params.amount,
      txType: "guild_donate",
      referenceId: `guild:${params.guildId}`,
      description: `تبرع لخزينة النقابة #${params.guildId}`,
    });

    db.prepare("UPDATE guilds SET treasury_coins = treasury_coins + ? WHERE id = ?").run(
      params.amount,
      params.guildId
    );
    db.prepare(
      "INSERT INTO guild_activity_logs (guild_id, actor_id, action, details, created_at) VALUES (?, ?, 'donate', ?, ?)"
    ).run(
      params.guildId,
      params.userId,
      `تبرع بـ ${params.amount.toLocaleString()} عملة لخزينة النقابة`,
      new Date().toISOString()
    );

    return getGuildDetails(db, params.guildId);
  });
}

export function upgradeGuildLevel(db: DatabaseSync, guildId: number, actorId: string) {
  return withTransaction(db, () => {
    const member = db
      .prepare("SELECT role FROM guild_members WHERE guild_id = ? AND user_id = ?")
      .get(guildId, actorId) as { role: string } | undefined;
    if (!member || member.role !== "leader") {
      throw new AppError("فقط قائد النقابة يمكنه ترقية مستوى النقابة من الخزينة.", 403);
    }

    const g = db
      .prepare("SELECT guild_level, treasury_coins FROM guilds WHERE id = ?")
      .get(guildId) as { guild_level: number; treasury_coins: number } | undefined;
    if (!g) throw new AppError("النقابة غير موجودة.", 404);
    if (g.guild_level >= 10) {
      throw new AppError("وصلت النقابة إلى الحد الأقصى للمستوى (10).", 400);
    }

    const upgradeCost = g.guild_level * 5000;
    if (g.treasury_coins < upgradeCost) {
      throw new AppError(
        `خزينة النقابة تحتاج ${upgradeCost.toLocaleString()} عملة للترقية (المتوفر: ${g.treasury_coins.toLocaleString()}).`,
        400
      );
    }

    db.prepare(
      "UPDATE guilds SET guild_level = guild_level + 1, treasury_coins = treasury_coins - ? WHERE id = ?"
    ).run(upgradeCost, guildId);

    db.prepare(
      "INSERT INTO guild_activity_logs (guild_id, actor_id, action, details, created_at) VALUES (?, ?, 'upgrade', ?, ?)"
    ).run(
      guildId,
      actorId,
      `ترقية النقابة إلى المستوى ${g.guild_level + 1} بتكلفة ${upgradeCost.toLocaleString()} من الخزينة`,
      new Date().toISOString()
    );

    return getGuildDetails(db, guildId);
  });
}

export function getGuildDetails(db: DatabaseSync, guildId: number) {
  const g = db.prepare("SELECT * FROM guilds WHERE id = ?").get(guildId) as
    | {
        id: number;
        name: string;
        emblem: string;
        description: string;
        leader_id: string;
        guild_level: number;
        treasury_coins: number;
        created_at: string;
      }
    | undefined;
  if (!g) return null;

  const members = db
    .prepare(
      `SELECT gm.user_id, gm.role, gm.joined_at, u.discord_name, u.minutes, u.verified_minutes, u.xp
       FROM guild_members gm
       JOIN users u ON u.user_id = gm.user_id
       WHERE gm.guild_id = ?
       ORDER BY CASE gm.role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END, u.minutes DESC`
    )
    .all(guildId) as Array<{
    user_id: string;
    role: string;
    joined_at: string;
    discord_name: string;
    minutes: number;
    verified_minutes: number;
    xp: number;
  }>;

  const logs = db
    .prepare(
      "SELECT * FROM guild_activity_logs WHERE guild_id = ? ORDER BY id DESC LIMIT 15"
    )
    .all(guildId);

  const totalMinutes = members.reduce((s, m) => s + m.minutes, 0);
  const totalVerifiedMinutes = members.reduce((s, m) => s + m.verified_minutes, 0);

  return {
    id: g.id,
    name: g.name,
    emblem: g.emblem,
    description: g.description,
    leaderId: g.leader_id,
    guildLevel: g.guild_level ?? 1,
    treasuryCoins: g.treasury_coins ?? 0,
    nextUpgradeCost: (g.guild_level ?? 1) * 5000,
    createdAt: g.created_at,
    totalMinutes,
    totalVerifiedMinutes,
    members: members.map((m) => ({
      userId: m.user_id,
      discordName: m.discord_name,
      role: m.role,
      minutes: m.minutes,
      verifiedMinutes: m.verified_minutes,
      level: levelInfo(m.xp).level,
    })),
    logs,
  };
}

export function listGuildLeaderboard(db: DatabaseSync) {
  const rows = db
    .prepare(
      `SELECT g.id, g.name, g.emblem, g.description, g.leader_id,
              g.guild_level, g.treasury_coins,
              COUNT(gm.user_id) as member_count,
              COALESCE(SUM(u.minutes), 0) as total_minutes,
              COALESCE(SUM(u.verified_minutes), 0) as total_verified_minutes
       FROM guilds g
       LEFT JOIN guild_members gm ON gm.guild_id = g.id
       LEFT JOIN users u ON u.user_id = gm.user_id
       GROUP BY g.id
       ORDER BY g.guild_level DESC, total_minutes DESC, member_count DESC`
    )
    .all();
  return rows;
}
