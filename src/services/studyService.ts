import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { SYSTEM_CONFIG, getIraqDateString } from "../config/settings";
import { withTransaction } from "../database/db";
import { AppError, requireRegisteredUser } from "../security/auth";
import { applyIncomeWithLoanRepaymentInTx } from "./loanService";
import { DAY_NAMES, MONTH_NAMES, computeStudyReward, levelInfo } from "../data/botData";

export interface StudyRoom {
  roomId: string;
  name: string;
  description: string;
  isActive: boolean;
}

export interface ActiveStudySession {
  id: string;
  userId: string;
  roomId: string;
  roomName: string;
  startedAt: number;
  lastTickAt: number;
  regularMinutes: number;
  verifiedMinutes: number;
  screenSharing: boolean;
  screenStartedAt: number | null;
  status: string;
}

export function listStudyRooms(db: DatabaseSync): StudyRoom[] {
  const rows = db
    .prepare(
      "SELECT room_id, name, description, is_active FROM approved_study_rooms WHERE is_active = 1 ORDER BY name"
    )
    .all() as Array<{ room_id: string; name: string; description: string; is_active: number }>;
  return rows.map((r) => ({
    roomId: r.room_id,
    name: r.name,
    description: r.description,
    isActive: r.is_active === 1,
  }));
}

export function addStudyRoom(
  db: DatabaseSync,
  roomId: string,
  name: string,
  description = ""
): StudyRoom {
  const cleanId = roomId.trim();
  const cleanName = name.trim();
  if (!cleanId || !cleanName) {
    throw new AppError("معرف الغرفة واسمها مطلوبان.", 400);
  }
  db.prepare(
    `INSERT INTO approved_study_rooms (room_id, name, description, is_active, created_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(room_id) DO UPDATE SET name = excluded.name, description = excluded.description, is_active = 1`
  ).run(cleanId, cleanName, description.trim(), new Date().toISOString());
  return { roomId: cleanId, name: cleanName, description: description.trim(), isActive: true };
}

export function removeStudyRoom(db: DatabaseSync, roomId: string): void {
  const res = db
    .prepare("UPDATE approved_study_rooms SET is_active = 0 WHERE room_id = ?")
    .run(roomId);
  if (res.changes === 0) {
    throw new AppError("غرفة الدراسة غير موجودة.", 404);
  }
}

export function getActiveStudySession(
  db: DatabaseSync,
  userId: string
): ActiveStudySession | null {
  const row = db
    .prepare(
      `SELECT s.*, r.name as room_name
       FROM study_sessions s
       LEFT JOIN approved_study_rooms r ON r.room_id = s.room_id
       WHERE s.user_id = ? AND s.status = 'active'
       ORDER BY s.started_at DESC LIMIT 1`
    )
    .get(userId) as
    | {
        id: string;
        user_id: string;
        room_id: string;
        room_name: string | null;
        started_at: number;
        last_tick_at: number;
        regular_minutes: number;
        verified_minutes: number;
        screen_sharing: number;
        screen_started_at: number | null;
        status: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    roomId: row.room_id,
    roomName: row.room_name ?? row.room_id,
    startedAt: row.started_at,
    lastTickAt: row.last_tick_at,
    regularMinutes: row.regular_minutes,
    verifiedMinutes: row.verified_minutes,
    screenSharing: row.screen_sharing === 1,
    screenStartedAt: row.screen_started_at,
    status: row.status,
  };
}

export function joinStudyRoom(
  db: DatabaseSync,
  params: {
    userId: string;
    roomId: string;
    screenSharing?: boolean;
    cameraOn?: boolean; // camera alone does NOT qualify as verified
    subjectId?: number | null;
    pomodoroTarget?: number;
    nowMs?: number;
  }
): ActiveStudySession {
  const now = params.nowMs ?? Date.now();
  return withTransaction(db, () => {
    requireRegisteredUser(db, params.userId);
    const room = db
      .prepare("SELECT room_id, name, is_active FROM approved_study_rooms WHERE room_id = ?")
      .get(params.roomId) as { room_id: string; name: string; is_active: number } | undefined;
    if (!room || room.is_active !== 1) {
      throw new AppError("هذه الغرفة غير معتمدة للدراسة.", 400);
    }

    const existing = getActiveStudySession(db, params.userId);
    if (existing) {
      if (existing.roomId === params.roomId) {
        return existing;
      }
      // Switch rooms safely: settle current session up to `now` first, then start in new room
      settleAndCloseSessionInTx(db, existing.id, now, "completed");
    }

    const userSub = db
      .prepare("SELECT active_subject_id FROM users WHERE user_id = ?")
      .get(params.userId) as { active_subject_id: number | null } | undefined;
    const resolvedSubjectId =
      params.subjectId !== undefined ? params.subjectId : userSub?.active_subject_id ?? null;
    const pomodoroTarget = [25, 50].includes(Number(params.pomodoroTarget))
      ? Number(params.pomodoroTarget)
      : 0;

    const sessionId = `SS-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
    const screenOn = Boolean(params.screenSharing);
    db.prepare(
      `INSERT INTO study_sessions (
        id, user_id, room_id, started_at, last_tick_at, regular_minutes, verified_minutes,
        screen_sharing, screen_started_at, status, subject_id, pomodoro_target
      ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, 'active', ?, ?)`
    ).run(
      sessionId,
      params.userId,
      params.roomId,
      now,
      now,
      screenOn ? 1 : 0,
      screenOn ? now : null,
      resolvedSubjectId,
      pomodoroTarget
    );

    if (screenOn) {
      db.prepare(
        "INSERT INTO study_screen_segments (session_id, user_id, started_at) VALUES (?, ?, ?)"
      ).run(sessionId, params.userId, now);
    }

    return getActiveStudySession(db, params.userId)!;
  });
}

function creditChallengeVerifiedMinutesInTx(
  db: DatabaseSync,
  params: {
    userId: string;
    sessionId: string;
    fromMs: number;
    toMs: number;
    verifiedMins: number;
  }
): void {
  if (params.verifiedMins <= 0) return;
  const activeChallenge = db
    .prepare(
      `SELECT c.id, c.started_at, c.ends_at
       FROM challenges c
       JOIN challenge_participants cp ON cp.challenge_id = c.id
       WHERE cp.user_id = ? AND cp.invite_status = 'accepted' AND c.status = 'active'`
    )
    .get(params.userId) as { id: string; started_at: number; ends_at: number } | undefined;

  if (!activeChallenge) return;

  // Strictly clamp credited window inside [started_at, ends_at]
  const clampedStart = Math.max(params.fromMs, activeChallenge.started_at);
  const clampedEnd = Math.min(params.toMs, activeChallenge.ends_at);
  if (clampedEnd <= clampedStart) return;

  const startBucket = Math.floor(clampedStart / 60000);
  const endBucket = Math.floor(clampedEnd / 60000);
  let credited = 0;
  const maxBuckets = Math.min(params.verifiedMins, Math.max(0, endBucket - startBucket));
  const nowIso = new Date().toISOString();

  for (let i = 0; i < maxBuckets; i++) {
    const bucket = startBucket + i;
    const res = db
      .prepare(
        "INSERT OR IGNORE INTO challenge_minute_logs (challenge_id, user_id, session_id, minute_bucket, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(activeChallenge.id, params.userId, params.sessionId, bucket, nowIso);
    if (res.changes > 0) {
      credited++;
    }
  }

  if (credited > 0) {
    db.prepare(
      "UPDATE challenge_participants SET verified_minutes = verified_minutes + ? WHERE challenge_id = ? AND user_id = ?"
    ).run(credited, activeChallenge.id, params.userId);
  }
}

function advanceSessionTickInTx(
  db: DatabaseSync,
  session: ActiveStudySession,
  nowMs: number
): { addedRegular: number; addedVerified: number } {
  const safeNow = Math.max(nowMs, session.lastTickAt);
  const elapsedMinutes = Math.floor((safeNow - session.lastTickAt) / 60000);
  if (elapsedMinutes <= 0) {
    return { addedRegular: 0, addedVerified: 0 };
  }

  // Verified minutes are a SUBSET of regular minutes (never additive!)
  let addedVerified = 0;
  if (session.screenSharing && session.screenStartedAt !== null) {
    const screenStart = Math.max(session.lastTickAt, session.screenStartedAt);
    addedVerified = Math.min(
      elapsedMinutes,
      Math.max(0, Math.floor((safeNow - screenStart) / 60000))
    );
  }

  const newTickAt = session.lastTickAt + elapsedMinutes * 60000;
  db.prepare(
    `UPDATE study_sessions
     SET last_tick_at = ?, regular_minutes = regular_minutes + ?, verified_minutes = verified_minutes + ?
     WHERE id = ?`
  ).run(newTickAt, elapsedMinutes, addedVerified, session.id);

  if (addedVerified > 0) {
    db.prepare(
      `UPDATE study_screen_segments
       SET minutes_credited = minutes_credited + ?
       WHERE session_id = ? AND ended_at IS NULL`
    ).run(addedVerified, session.id);

    creditChallengeVerifiedMinutesInTx(db, {
      userId: session.userId,
      sessionId: session.id,
      fromMs: session.lastTickAt,
      toMs: newTickAt,
      verifiedMins: addedVerified,
    });
  }

  return { addedRegular: elapsedMinutes, addedVerified };
}

export function setScreenShareState(
  db: DatabaseSync,
  userId: string,
  screenSharing: boolean,
  nowMs = Date.now()
): ActiveStudySession {
  return withTransaction(db, () => {
    const session = getActiveStudySession(db, userId);
    if (!session) {
      throw new AppError("لا توجد جلسة دراسة نشطة حالياً.", 404);
    }

    // Settle any whole minutes up to this moment before toggling screen share
    advanceSessionTickInTx(db, session, nowMs);
    const updated = getActiveStudySession(db, userId)!;

    if (screenSharing && !updated.screenSharing) {
      db.prepare(
        "UPDATE study_sessions SET screen_sharing = 1, screen_started_at = ? WHERE id = ?"
      ).run(nowMs, updated.id);
      db.prepare(
        "INSERT INTO study_screen_segments (session_id, user_id, started_at) VALUES (?, ?, ?)"
      ).run(updated.id, userId, nowMs);
    } else if (!screenSharing && updated.screenSharing) {
      db.prepare(
        "UPDATE study_sessions SET screen_sharing = 0, screen_started_at = NULL WHERE id = ?"
      ).run(updated.id);
      db.prepare(
        "UPDATE study_screen_segments SET ended_at = ? WHERE session_id = ? AND ended_at IS NULL"
      ).run(nowMs, updated.id);
    }

    return getActiveStudySession(db, userId)!;
  });
}

function settleAndCloseSessionInTx(
  db: DatabaseSync,
  sessionId: string,
  endMs: number,
  finalStatus: "completed" | "disconnected" | "recovered"
) {
  const row = db
    .prepare(
      `SELECT s.*, r.name as room_name
       FROM study_sessions s
       LEFT JOIN approved_study_rooms r ON r.room_id = s.room_id
       WHERE s.id = ? AND s.status = 'active'`
    )
    .get(sessionId) as
    | {
        id: string;
        user_id: string;
        room_id: string;
        room_name: string | null;
        started_at: number;
        last_tick_at: number;
        regular_minutes: number;
        verified_minutes: number;
        screen_sharing: number;
        screen_started_at: number | null;
        status: string;
      }
    | undefined;
  if (!row) {
    throw new AppError("الجلسة غير نشطة أو منتهية بالفعل.", 404);
  }

  const session: ActiveStudySession = {
    id: row.id,
    userId: row.user_id,
    roomId: row.room_id,
    roomName: row.room_name ?? row.room_id,
    startedAt: row.started_at,
    lastTickAt: row.last_tick_at,
    regularMinutes: row.regular_minutes,
    verifiedMinutes: row.verified_minutes,
    screenSharing: row.screen_sharing === 1,
    screenStartedAt: row.screen_started_at,
    status: row.status,
  };

  // Clamp endMs so minutes never exceed actual session window
  const clampedEnd = Math.max(session.startedAt, endMs);
  advanceSessionTickInTx(db, session, clampedEnd);

  if (session.screenSharing) {
    db.prepare(
      "UPDATE study_screen_segments SET ended_at = ? WHERE session_id = ? AND ended_at IS NULL"
    ).run(clampedEnd, session.id);
  }

  db.prepare(
    "UPDATE study_sessions SET status = ?, ended_at = ?, screen_sharing = 0 WHERE id = ?"
  ).run(finalStatus, clampedEnd, session.id);

  const finalized = db
    .prepare("SELECT regular_minutes, verified_minutes, subject_id, pomodoro_target FROM study_sessions WHERE id = ?")
    .get(session.id) as {
    regular_minutes: number;
    verified_minutes: number;
    subject_id: number | null;
    pomodoro_target: number;
  };

  const totalRegular = finalized.regular_minutes;
  const totalVerified = finalized.verified_minutes;

  let earned = 0;
  let pomodoroBonus = 0;
  let repaid = 0;
  let oldLevel = 1;
  let newLevel = 1;
  let unlockedStudent = false;

  if (totalRegular > 0) {
    const userRow = db
      .prepare("SELECT xp, minutes, job, gender FROM users WHERE user_id = ?")
      .get(session.userId) as {
      xp: number;
      minutes: number;
      job: string | null;
      gender: "male" | "female" | null;
    };

    const alreadyToday = getMinutesInPeriod(db, session.userId, "day").regular;
    oldLevel = levelInfo(userRow.xp).level;
    earned = computeStudyReward(totalRegular, alreadyToday);

    const newMinutes = userRow.minutes + totalRegular;
    const newXp = userRow.xp + totalRegular;

    db.prepare(
      "UPDATE users SET minutes = minutes + ?, verified_minutes = verified_minutes + ?, xp = ? WHERE user_id = ?"
    ).run(totalRegular, totalVerified, newXp, session.userId);

    if (finalized.subject_id) {
      db.prepare(
        "UPDATE study_subjects SET logged_minutes = logged_minutes + ? WHERE id = ? AND user_id = ?"
      ).run(totalRegular, finalized.subject_id, session.userId);
    }

    const todayStr = getIraqDateString(0);
    db.prepare(
      `INSERT INTO study_daily_log (user_id, day, regular_minutes, verified_minutes)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET
         regular_minutes = regular_minutes + excluded.regular_minutes,
         verified_minutes = verified_minutes + excluded.verified_minutes`
    ).run(session.userId, todayStr, totalRegular, totalVerified);

    if (userRow.job === null && userRow.gender !== null && newMinutes >= SYSTEM_CONFIG.STUDENT_AFTER_MIN) {
      db.prepare("UPDATE users SET job = 'student' WHERE user_id = ?").run(session.userId);
      db.prepare(
        "INSERT OR IGNORE INTO user_inventory (user_id, product_id, variant, purchased_at) VALUES (?, 'student', ?, ?)"
      ).run(session.userId, userRow.gender, new Date().toISOString());
      unlockedStudent = true;
    }

    const incomeRes = applyIncomeWithLoanRepaymentInTx(db, {
      userId: session.userId,
      grossAmount: earned,
      txType: "study_reward",
      sourceType: "study",
      referenceId: session.id,
      description: `مكافأة دراسة (${totalRegular} دقيقة عادية، ${totalVerified} موثقة بالشاشة)`,
    });
    repaid = incomeRes.repaidAmount;

    if (finalized.pomodoro_target > 0 && totalRegular >= finalized.pomodoro_target) {
      pomodoroBonus = finalized.pomodoro_target >= 50 ? 40 : 15;
      db.prepare("UPDATE users SET pomodoro_count = pomodoro_count + 1 WHERE user_id = ?").run(session.userId);
      const pomoRes = applyIncomeWithLoanRepaymentInTx(db, {
        userId: session.userId,
        grossAmount: pomodoroBonus,
        txType: "pomodoro_bonus",
        sourceType: "pomodoro",
        referenceId: session.id,
        description: `🍅 مكافأة إتمام دورة بومودورو (${finalized.pomodoro_target} د)`,
      });
      repaid += pomoRes.repaidAmount;
    }

    newLevel = levelInfo(newXp).level;
  }

  return {
    sessionId: session.id,
    regularMinutes: totalRegular,
    verifiedMinutes: totalVerified,
    earned,
    pomodoroBonus,
    repaid,
    oldLevel,
    newLevel,
    unlockedStudent,
  };
}

export function leaveStudyRoom(
  db: DatabaseSync,
  userId: string,
  nowMs = Date.now(),
  reason: "completed" | "disconnected" = "completed"
) {
  return withTransaction(db, () => {
    const active = getActiveStudySession(db, userId);
    if (!active) {
      throw new AppError("لا توجد جلسة دراسة نشطة لإنهائها.", 404);
    }
    return settleAndCloseSessionInTx(db, active.id, nowMs, reason);
  });
}

/**
 * Recovers dangling active sessions after an unexpected server/bot crash or restart.
 * Only credits time up to `recoveredAtMs` (or bounded by `last_tick_at` if offline gap policy applies),
 * never inventing downtime minutes when `capAtLastTick` is enabled.
 */
export function recoverInterruptedSessions(
  db: DatabaseSync,
  options: { capAtLastTick?: boolean; nowMs?: number } = {}
): number {
  const activeRows = db
    .prepare("SELECT id, last_tick_at FROM study_sessions WHERE status = 'active'")
    .all() as Array<{ id: string; last_tick_at: number }>;

  let recovered = 0;
  for (const row of activeRows) {
    withTransaction(db, () => {
      const endMs = options.capAtLastTick ? row.last_tick_at : options.nowMs ?? Date.now();
      settleAndCloseSessionInTx(db, row.id, endMs, "recovered");
      recovered++;
    });
  }
  return recovered;
}

export function tickActiveStudySessions(db: DatabaseSync, nowMs = Date.now()): number {
  const activeRows = db
    .prepare("SELECT user_id FROM study_sessions WHERE status = 'active'")
    .all() as Array<{ user_id: string }>;
  let ticked = 0;
  for (const r of activeRows) {
    withTransaction(db, () => {
      const s = getActiveStudySession(db, r.user_id);
      if (!s) return;
      const res = advanceSessionTickInTx(db, s, nowMs);
      if (res.addedRegular > 0) ticked++;
    });
  }
  return ticked;
}

export function getUserStreak(db: DatabaseSync, userId: string): number {
  const rows = db
    .prepare(
      `SELECT day FROM study_daily_log WHERE user_id = ? AND regular_minutes > 0
       UNION
       SELECT saved_day as day FROM streak_shield_uses WHERE user_id = ?
       ORDER BY day DESC LIMIT 400`
    )
    .all(userId, userId) as Array<{ day: string }>;
  const daySet = new Set(rows.map((r) => r.day));
  let offset = 0;
  if (!daySet.has(getIraqDateString(0))) {
    offset = 1;
  }
  let count = 0;
  while (daySet.has(getIraqDateString(offset))) {
    count++;
    offset++;
  }
  return count;
}

function getPeriodRange(period: string): [string, string] | null {
  const todayStr = getIraqDateString(0);
  const [y, m, d] = todayStr.split("-").map(Number);
  const dtObj = new Date(Date.UTC(y, m - 1, d));
  if (period === "day") return [todayStr, todayStr];
  if (period === "week") {
    const daysSinceSat = (dtObj.getUTCDay() + 1) % 7;
    const start = new Date(dtObj.getTime() - daysSinceSat * 86400 * 1000);
    return [start.toISOString().slice(0, 10), todayStr];
  }
  if (period === "month") return [`${y}-${String(m).padStart(2, "0")}-01`, todayStr];
  if (period === "year") return [`${y}-01-01`, todayStr];
  return null;
}

export function getMinutesInPeriod(
  db: DatabaseSync,
  userId: string,
  period: string
): { regular: number; verified: number } {
  const rng = getPeriodRange(period);
  if (!rng) {
    const u = db
      .prepare("SELECT minutes, verified_minutes FROM users WHERE user_id = ?")
      .get(userId) as { minutes: number; verified_minutes: number } | undefined;
    return { regular: u?.minutes ?? 0, verified: u?.verified_minutes ?? 0 };
  }
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(regular_minutes), 0) as r, COALESCE(SUM(verified_minutes), 0) as v
       FROM study_daily_log WHERE user_id = ? AND day >= ? AND day <= ?`
    )
    .get(userId, rng[0], rng[1]) as { r: number; v: number };
  return { regular: row.r, verified: row.v };
}

export function getLast7DaysMinutes(db: DatabaseSync, userId: string): number {
  const start = getIraqDateString(6);
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(regular_minutes), 0) as r FROM study_daily_log WHERE user_id = ? AND day >= ?"
    )
    .get(userId, start) as { r: number };
  return row.r;
}

export function buildUserStudyStats(db: DatabaseSync, userId: string) {
  const todayStr = getIraqDateString(0);
  const [yStr, mStr] = todayStr.split("-");
  const currentYear = Number(yStr);
  const currentMonth = Number(mStr);

  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const dStr = getIraqDateString(i);
    const [yy, mm, dd] = dStr.split("-").map(Number);
    const utcDate = new Date(Date.UTC(yy, mm - 1, dd));
    const pyWeekday = (utcDate.getUTCDay() + 6) % 7;
    const row = db
      .prepare(
        "SELECT regular_minutes, verified_minutes FROM study_daily_log WHERE user_id = ? AND day = ?"
      )
      .get(userId, dStr) as { regular_minutes: number; verified_minutes: number } | undefined;
    last7Days.push({
      date: dStr,
      label: `${DAY_NAMES[pyWeekday]} ${dd}/${mm}`,
      minutes: row?.regular_minutes ?? 0,
      verifiedMinutes: row?.verified_minutes ?? 0,
    });
  }

  const months = [];
  for (let m = 1; m <= currentMonth; m++) {
    const prefix = `${currentYear}-${String(m).padStart(2, "0")}%`;
    const row = db
      .prepare(
        "SELECT COALESCE(SUM(regular_minutes), 0) as r, COALESCE(SUM(verified_minutes), 0) as v FROM study_daily_log WHERE user_id = ? AND day LIKE ?"
      )
      .get(userId, prefix) as { r: number; v: number };
    months.push({
      month: MONTH_NAMES[m - 1],
      minutes: row.r,
      verifiedMinutes: row.v,
    });
  }

  const day = getMinutesInPeriod(db, userId, "day");
  const week = getMinutesInPeriod(db, userId, "week");
  const month = getMinutesInPeriod(db, userId, "month");
  const year = getMinutesInPeriod(db, userId, "year");
  const all = getMinutesInPeriod(db, userId, "all");

  return {
    day: day.regular,
    dayVerified: day.verified,
    week: week.regular,
    weekVerified: week.verified,
    month: month.regular,
    year: year.regular,
    all: all.regular,
    allVerified: all.verified,
    streak: getUserStreak(db, userId),
    last7Days,
    months,
    yearNumber: currentYear,
  };
}
