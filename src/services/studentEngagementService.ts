import { DatabaseSync } from "node:sqlite";
import { getIraqDateString } from "../config/settings";
import { withTransaction } from "../database/db";
import { AppError, requireRegisteredUser } from "../security/auth";
import { debitBankInTx } from "./bankService";
import { applyIncomeWithLoanRepaymentInTx } from "./loanService";
import { getMinutesInPeriod, getUserStreak } from "./studyService";

export const STREAK_SHIELD_PRICE = 350;
export const MAX_STREAK_SHIELDS = 3;
export const DAILY_CHEST_MIN_MINUTES = 30;

export interface StudyPerk {
  id: string;
  title: string;
  description: string;
  requiredMinutes: number;
  badge: string;
  unlocked: boolean;
  shopDiscountPct: number;
  xpBoostPct: number;
}

export const STUDY_PERKS_CATALOG: Array<Omit<StudyPerk, "unlocked">> = [
  {
    id: "perk_5h",
    title: "طالب منضبط (5 ساعات)",
    description: "خصم 5% دائم على مشتريات المتجر التجميلية",
    requiredMinutes: 300,
    badge: "🔖 خصم 5%",
    shopDiscountPct: 5,
    xpBoostPct: 0,
  },
  {
    id: "perk_15h",
    title: "نخبة التركيز (15 ساعة)",
    description: "مضاعف +15% XP إضافية من المهام والصناديق",
    requiredMinutes: 900,
    badge: "⚡ +15% XP",
    shopDiscountPct: 5,
    xpBoostPct: 15,
  },
  {
    id: "perk_30h",
    title: "حامي العادة (30 ساعة)",
    description: "أولوية في الصندوق اليومي ومضاعف +20% XP",
    requiredMinutes: 1800,
    badge: "🛡️ +20% XP",
    shopDiscountPct: 5,
    xpBoostPct: 20,
  },
  {
    id: "perk_60h",
    title: "أسطورة الاجتهاد VIP (60 ساعة)",
    description: "خصم 10% بالمتجر + مضاعف +25% XP وشارة VIP",
    requiredMinutes: 3600,
    badge: "👑 VIP +25% XP",
    shopDiscountPct: 10,
    xpBoostPct: 25,
  },
];

export function getUnlockedStudyPerks(totalMinutes: number): {
  perks: StudyPerk[];
  shopDiscountPct: number;
  xpBoostPct: number;
} {
  let shopDiscountPct = 0;
  let xpBoostPct = 0;
  const perks = STUDY_PERKS_CATALOG.map((p) => {
    const unlocked = totalMinutes >= p.requiredMinutes;
    if (unlocked) {
      shopDiscountPct = Math.max(shopDiscountPct, p.shopDiscountPct);
      xpBoostPct = Math.max(xpBoostPct, p.xpBoostPct);
    }
    return { ...p, unlocked };
  });
  return { perks, shopDiscountPct, xpBoostPct };
}

export function getStreakMultiplier(streak: number): number {
  if (streak >= 30) return 2.0;
  if (streak >= 14) return 1.75;
  if (streak >= 7) return 1.5;
  if (streak >= 3) return 1.25;
  return 1.0;
}

export interface DailyQuestItem {
  id: string;
  title: string;
  description: string;
  metric: "regular_today" | "verified_today";
  targetMinutes: number;
  progressMinutes: number;
  baseCoins: number;
  baseXp: number;
  finalCoins: number;
  finalXp: number;
  completed: boolean;
  claimed: boolean;
}

const DAILY_QUESTS_DEF = [
  {
    id: "warmup_25",
    title: "🔥 إحماء التركيز (25د)",
    description: "ادرس 25 دقيقة متراكمة اليوم بتوقيت العراق",
    metric: "regular_today" as const,
    targetMinutes: 25,
    baseCoins: 40,
    baseXp: 45,
  },
  {
    id: "focus_60",
    title: "⏱️ ساعة الإنجاز الذهبية (60د)",
    description: "أكمل 60 دقيقة دراسة اليوم",
    metric: "regular_today" as const,
    targetMinutes: 60,
    baseCoins: 110,
    baseXp: 120,
  },
  {
    id: "verified_45",
    title: "🖥️ الالتزام الموثّق بالشاشة (45د)",
    description: "ادرس 45 دقيقة بمشاركة الشاشة اليوم",
    metric: "verified_today" as const,
    targetMinutes: 45,
    baseCoins: 150,
    baseXp: 160,
  },
  {
    id: "marathon_120",
    title: "👑 ماراثون الدراسة (120د)",
    description: "اجمع ساعتين دراسة حقيقية اليوم",
    metric: "regular_today" as const,
    targetMinutes: 120,
    baseCoins: 300,
    baseXp: 320,
  },
];

export function getEngagementSummary(db: DatabaseSync, userId: string) {
  const today = getIraqDateString(0);
  const userRow = db
    .prepare("SELECT minutes, streak_shields, pomodoro_count, active_subject_id FROM users WHERE user_id = ?")
    .get(userId) as
    | {
        minutes: number;
        streak_shields: number;
        pomodoro_count: number;
        active_subject_id: number | null;
      }
    | undefined;

  const totalMinutes = userRow?.minutes ?? 0;
  const streak = getUserStreak(db, userId);
  const streakMultiplier = getStreakMultiplier(streak);
  const { perks, shopDiscountPct, xpBoostPct } = getUnlockedStudyPerks(totalMinutes);
  const todayStats = getMinutesInPeriod(db, userId, "day");

  const claimedRows = db
    .prepare("SELECT quest_id FROM daily_quest_claims WHERE user_id = ? AND day = ?")
    .all(userId, today) as Array<{ quest_id: string }>;
  const claimedSet = new Set(claimedRows.map((r) => r.quest_id));

  const quests: DailyQuestItem[] = DAILY_QUESTS_DEF.map((q) => {
    const progressMinutes =
      q.metric === "verified_today" ? todayStats.verified : todayStats.regular;
    const finalCoins = Math.round(q.baseCoins * streakMultiplier);
    const finalXp = Math.round(q.baseXp * (1 + xpBoostPct / 100));
    return {
      ...q,
      progressMinutes,
      finalCoins,
      finalXp,
      completed: progressMinutes >= q.targetMinutes,
      claimed: claimedSet.has(q.id),
    };
  });

  const chestClaim = db
    .prepare("SELECT reward_coins, reward_xp, reward_shield FROM daily_chest_claims WHERE user_id = ? AND day = ?")
    .get(userId, today) as
    | { reward_coins: number; reward_xp: number; reward_shield: number }
    | undefined;

  const subjects = listSubjects(db, userId);

  return {
    today,
    streak,
    streakMultiplier,
    streakShields: userRow?.streak_shields ?? 0,
    maxStreakShields: MAX_STREAK_SHIELDS,
    shieldPrice: STREAK_SHIELD_PRICE,
    pomodoroCount: userRow?.pomodoro_count ?? 0,
    activeSubjectId: userRow?.active_subject_id ?? null,
    shopDiscountPct,
    xpBoostPct,
    perks,
    quests,
    dailyChest: {
      requiredMinutes: DAILY_CHEST_MIN_MINUTES,
      todayMinutes: todayStats.regular,
      unlocked: todayStats.regular >= DAILY_CHEST_MIN_MINUTES,
      claimed: Boolean(chestClaim),
      lastReward: chestClaim
        ? {
            coins: chestClaim.reward_coins,
            xp: chestClaim.reward_xp,
            shield: chestClaim.reward_shield,
          }
        : null,
    },
    subjects,
  };
}

export function claimDailyQuest(db: DatabaseSync, userId: string, questId: string) {
  return withTransaction(db, () => {
    requireRegisteredUser(db, userId);
    const def = DAILY_QUESTS_DEF.find((q) => q.id === questId);
    if (!def) throw new AppError("المهمة غير موجودة.", 404);

    const today = getIraqDateString(0);
    const already = db
      .prepare("SELECT 1 FROM daily_quest_claims WHERE user_id = ? AND day = ? AND quest_id = ?")
      .get(userId, today, questId);
    if (already) {
      throw new AppError("استلمت مكافأة هذه المهمة اليوم بالفعل.", 400);
    }

    const todayStats = getMinutesInPeriod(db, userId, "day");
    const progress = def.metric === "verified_today" ? todayStats.verified : todayStats.regular;
    if (progress < def.targetMinutes) {
      throw new AppError(
        `لم تكمل المهمة بعد (${progress}/${def.targetMinutes} دقيقة اليوم).`,
        400
      );
    }

    const userRow = db
      .prepare("SELECT minutes FROM users WHERE user_id = ?")
      .get(userId) as { minutes: number };
    const streak = getUserStreak(db, userId);
    const mult = getStreakMultiplier(streak);
    const { xpBoostPct } = getUnlockedStudyPerks(userRow.minutes);

    const coins = Math.round(def.baseCoins * mult);
    const xp = Math.round(def.baseXp * (1 + xpBoostPct / 100));
    const now = new Date().toISOString();

    db.prepare(
      "INSERT INTO daily_quest_claims (user_id, day, quest_id, reward_coins, reward_xp, claimed_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(userId, today, questId, coins, xp, now);

    db.prepare("UPDATE users SET xp = xp + ? WHERE user_id = ?").run(xp, userId);
    const income = applyIncomeWithLoanRepaymentInTx(db, {
      userId,
      grossAmount: coins,
      txType: "daily_quest",
      sourceType: "quest",
      referenceId: `${today}:${questId}`,
      description: `مكافأة مهمة يومية: ${def.title} (مضاعف ${mult}x)`,
    });

    return {
      ok: true,
      questId,
      coins,
      xp,
      repaid: income.repaidAmount,
      multiplier: mult,
    };
  });
}

export function openDailyFocusChest(db: DatabaseSync, userId: string, randomSeed?: number) {
  return withTransaction(db, () => {
    requireRegisteredUser(db, userId);
    const today = getIraqDateString(0);
    const existing = db
      .prepare("SELECT 1 FROM daily_chest_claims WHERE user_id = ? AND day = ?")
      .get(userId, today);
    if (existing) {
      throw new AppError("فتحت صندوق التركيز اليومي لهذا اليوم بالفعل.", 400);
    }

    const todayStats = getMinutesInPeriod(db, userId, "day");
    if (todayStats.regular < DAILY_CHEST_MIN_MINUTES) {
      throw new AppError(
        `يُفتح صندوق التركيز بعد إكمال ${DAILY_CHEST_MIN_MINUTES} دقيقة دراسة اليوم (الحالي: ${todayStats.regular} د).`,
        400
      );
    }

    const userRow = db
      .prepare("SELECT minutes, streak_shields FROM users WHERE user_id = ?")
      .get(userId) as { minutes: number; streak_shields: number };
    const streak = getUserStreak(db, userId);
    const mult = getStreakMultiplier(streak);
    const { xpBoostPct } = getUnlockedStudyPerks(userRow.minutes);

    const roll = randomSeed ?? Math.random();
    const baseRollCoins = Math.floor(60 + roll * 180);
    const coins = Math.round(baseRollCoins * mult);
    const xp = Math.round(80 * (1 + xpBoostPct / 100));
    const bonusShield = roll >= 0.8 && userRow.streak_shields < MAX_STREAK_SHIELDS ? 1 : 0;

    db.prepare(
      "INSERT INTO daily_chest_claims (user_id, day, reward_coins, reward_xp, reward_shield, claimed_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(userId, today, coins, xp, bonusShield, new Date().toISOString());

    db.prepare("UPDATE users SET xp = xp + ?, streak_shields = streak_shields + ? WHERE user_id = ?").run(
      xp,
      bonusShield,
      userId
    );

    const income = applyIncomeWithLoanRepaymentInTx(db, {
      userId,
      grossAmount: coins,
      txType: "daily_chest",
      sourceType: "chest",
      referenceId: today,
      description: `🎁 صندوق التركيز اليومي (${mult}x)`,
    });

    return {
      ok: true,
      coins,
      xp,
      bonusShield,
      repaid: income.repaidAmount,
    };
  });
}

export function buyStreakShield(db: DatabaseSync, userId: string) {
  return withTransaction(db, () => {
    requireRegisteredUser(db, userId);
    const row = db
      .prepare("SELECT streak_shields FROM users WHERE user_id = ?")
      .get(userId) as { streak_shields: number };
    if (row.streak_shields >= MAX_STREAK_SHIELDS) {
      throw new AppError(`لديك الحد الأقصى من دروع السلسلة (${MAX_STREAK_SHIELDS}).`, 400);
    }

    debitBankInTx(db, {
      userId,
      amount: STREAK_SHIELD_PRICE,
      txType: "streak_shield_buy",
      description: "🛡️ شراء درع حماية سلسلة الدراسة",
    });

    db.prepare("UPDATE users SET streak_shields = streak_shields + 1 WHERE user_id = ?").run(userId);
    return { ok: true, streakShields: row.streak_shields + 1 };
  });
}

export function protectMissedYesterdayWithShield(db: DatabaseSync, userId: string) {
  return withTransaction(db, () => {
    requireRegisteredUser(db, userId);
    const row = db
      .prepare("SELECT streak_shields FROM users WHERE user_id = ?")
      .get(userId) as { streak_shields: number };
    if (row.streak_shields <= 0) {
      throw new AppError("لا تملك أي درع سلسلة متاح.", 400);
    }

    const yesterday = getIraqDateString(1);
    const dayBefore = getIraqDateString(2);

    const studiedYesterday = db
      .prepare("SELECT regular_minutes FROM study_daily_log WHERE user_id = ? AND day = ? AND regular_minutes > 0")
      .get(userId, yesterday);
    const shieldedYesterday = db
      .prepare("SELECT 1 FROM streak_shield_uses WHERE user_id = ? AND saved_day = ?")
      .get(userId, yesterday);

    if (studiedYesterday || shieldedYesterday) {
      throw new AppError("يوم أمس مسجّل أو محمي مسبقاً ولا يحتاج درعاً.", 400);
    }

    const activeDayBefore =
      db.prepare("SELECT 1 FROM study_daily_log WHERE user_id = ? AND day = ? AND regular_minutes > 0").get(userId, dayBefore) ||
      db.prepare("SELECT 1 FROM streak_shield_uses WHERE user_id = ? AND saved_day = ?").get(userId, dayBefore);

    if (!activeDayBefore) {
      throw new AppError("لا توجد سلسلة نشطة قبل أمس لحمايتها.", 400);
    }

    db.prepare("UPDATE users SET streak_shields = streak_shields - 1 WHERE user_id = ?").run(userId);
    db.prepare("INSERT INTO streak_shield_uses (user_id, saved_day, used_at) VALUES (?, ?, ?)").run(
      userId,
      yesterday,
      new Date().toISOString()
    );

    return { ok: true, savedDay: yesterday, newStreak: getUserStreak(db, userId) };
  });
}

export function listSubjects(db: DatabaseSync, userId: string) {
  return db
    .prepare(
      `SELECT id, name, color, exam_date as examDate, target_weekly_minutes as targetWeeklyMinutes,
              logged_minutes as loggedMinutes
       FROM study_subjects WHERE user_id = ? ORDER BY id DESC`
    )
    .all(userId) as Array<{
    id: number;
    name: string;
    color: string;
    examDate: string | null;
    targetWeeklyMinutes: number;
    loggedMinutes: number;
  }>;
}

export function createSubject(
  db: DatabaseSync,
  params: { userId: string; name: string; color?: string; examDate?: string; targetWeeklyMinutes?: number }
) {
  return withTransaction(db, () => {
    requireRegisteredUser(db, params.userId);
    const cleanName = params.name.trim().slice(0, 50);
    if (cleanName.length < 2) {
      throw new AppError("اسم المادة يجب أن يكون حرفين على الأقل.", 400);
    }
    const target = Number(params.targetWeeklyMinutes || 300);
    const exam = params.examDate && /^\d{4}-\d{2}-\d{2}$/.test(params.examDate) ? params.examDate : null;
    const res = db
      .prepare(
        `INSERT INTO study_subjects (user_id, name, color, exam_date, target_weekly_minutes, logged_minutes, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        params.userId,
        cleanName,
        params.color || "#5865F2",
        exam,
        Math.max(30, Math.min(3000, target)),
        new Date().toISOString()
      );
    const id = Number(res.lastInsertRowid);
    db.prepare("UPDATE users SET active_subject_id = ? WHERE user_id = ?").run(id, params.userId);
    return { id, name: cleanName, examDate: exam };
  });
}

export function setActiveSubject(db: DatabaseSync, userId: string, subjectId: number | null) {
  requireRegisteredUser(db, userId);
  if (subjectId !== null) {
    const owned = db
      .prepare("SELECT 1 FROM study_subjects WHERE id = ? AND user_id = ?")
      .get(subjectId, userId);
    if (!owned) throw new AppError("المادة غير موجودة.", 404);
  }
  db.prepare("UPDATE users SET active_subject_id = ? WHERE user_id = ?").run(subjectId, userId);
  return { ok: true, activeSubjectId: subjectId };
}

export function deleteSubject(db: DatabaseSync, userId: string, subjectId: number) {
  requireRegisteredUser(db, userId);
  const res = db.prepare("DELETE FROM study_subjects WHERE id = ? AND user_id = ?").run(subjectId, userId);
  if (res.changes === 0) throw new AppError("المادة غير موجودة.", 404);
  db.prepare("UPDATE users SET active_subject_id = NULL WHERE user_id = ? AND active_subject_id = ?").run(
    userId,
    subjectId
  );
  return { ok: true };
}
