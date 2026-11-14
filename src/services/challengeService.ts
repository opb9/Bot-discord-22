import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { SYSTEM_CONFIG } from "../config/settings";
import { withTransaction } from "../database/db";
import { AppError, logAudit, requireAdmin, requireRegisteredUser } from "../security/auth";
import {
  consumeReservedEscrowInTx,
  creditBankInTx,
  releaseEscrowRefundInTx,
  requireBankAccount,
  reserveEscrowInTx,
} from "./bankService";
import { applyIncomeWithLoanRepaymentInTx } from "./loanService";

export type ChallengeMode = "wager" | "free";
export type TeamKey = "A" | "B";

export interface CreateChallengeInput {
  creatorId: string;
  title: string;
  mode: ChallengeMode;
  teamSize: 1 | 2 | 4 | 8;
  betAmount: number;
  durationHours: number;
  teamAIds: string[];
  teamBIds: string[];
  nowMs?: number;
}

function assertNoActiveChallenge(db: DatabaseSync, userId: string): void {
  const row = db
    .prepare(
      `SELECT c.id FROM challenges c
       JOIN challenge_participants cp ON cp.challenge_id = c.id
       WHERE cp.user_id = ?
         AND cp.invite_status IN ('accepted', 'pending')
         AND c.status IN ('pending', 'active', 'frozen')
       LIMIT 1`
    )
    .get(userId) as { id: string } | undefined;
  if (row) {
    throw new AppError(`اللاعب ${userId} مشارك أو مدعو في تحدٍ نشط/معلق بالفعل (${row.id}).`, 400);
  }
}

export function createChallenge(db: DatabaseSync, input: CreateChallengeInput) {
  const now = input.nowMs ?? Date.now();
  if (!SYSTEM_CONFIG.CHALLENGE_ALLOWED_SIZES.includes(input.teamSize)) {
    throw new AppError("حجم الفريق المسموح: 1 أو 2 أو 4 أو 8 ضد مثلهم.", 400);
  }
  const minHours = SYSTEM_CONFIG.CHALLENGE_MIN_HOURS;
  const maxHours = SYSTEM_CONFIG.CHALLENGE_MAX_DAYS * 24;
  if (!Number.isInteger(input.durationHours) || input.durationHours < minHours || input.durationHours > maxHours) {
    throw new AppError(`مدة التحدي يجب أن تكون بين ${minHours} ساعة و${maxHours} ساعة (7 أيام).`, 400);
  }

  let betAmount = 0;
  if (input.mode === "wager") {
    if (!SYSTEM_CONFIG.CHALLENGE_ALLOWED_BETS.includes(input.betAmount as 100)) {
      throw new AppError("مبلغ الرهان غير مسموح. اختر من الفئات المعتمدة فقط.", 400);
    }
    betAmount = input.betAmount;
  }

  const allTeamA = Array.from(new Set(input.teamAIds));
  const allTeamB = Array.from(new Set(input.teamBIds));
  if (!allTeamA.includes(input.creatorId) && !allTeamB.includes(input.creatorId)) {
    allTeamA.unshift(input.creatorId);
  }
  if (allTeamA.length !== input.teamSize || allTeamB.length !== input.teamSize) {
    throw new AppError(`يجب تحديد ${input.teamSize} لاعبين بالضبط لكل فريق.`, 400);
  }

  const allParticipants = [...allTeamA, ...allTeamB];
  if (new Set(allParticipants).size !== allParticipants.length) {
    throw new AppError("لا يمكن وضع اللاعب نفسه في أكثر من فريق أو تكراره.", 400);
  }

  return withTransaction(db, () => {
    for (const uid of allParticipants) {
      requireRegisteredUser(db, uid);
      requireBankAccount(db, uid);
      assertNoActiveChallenge(db, uid);
    }

    const challengeId = `CH-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const inviteExpiresAt = now + SYSTEM_CONFIG.CHALLENGE_INVITE_EXPIRY_HOURS * 3600 * 1000;
    const nowIso = new Date(now).toISOString();

    db.prepare(
      `INSERT INTO challenges (
        id, creator_id, title, mode, team_size, bet_amount, duration_hours,
        status, invite_expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(
      challengeId,
      input.creatorId,
      input.title.trim() || "تحدي دراسة موثق",
      input.mode,
      input.teamSize,
      betAmount,
      input.durationHours,
      inviteExpiresAt,
      nowIso
    );

    const insertPart = db.prepare(
      `INSERT INTO challenge_participants (
        challenge_id, user_id, team, invite_status, bet_reserved, verified_minutes, payout_amount, joined_at
      ) VALUES (?, ?, ?, ?, 0, 0, 0, ?)`
    );

    for (const uid of allTeamA) {
      insertPart.run(challengeId, uid, "A", uid === input.creatorId ? "accepted" : "pending", nowIso);
    }
    for (const uid of allTeamB) {
      insertPart.run(challengeId, uid, "B", uid === input.creatorId ? "accepted" : "pending", nowIso);
    }

    return getChallengeForViewer(db, challengeId, input.creatorId);
  });
}

function tryStartChallengeInTx(db: DatabaseSync, challengeId: string, nowMs: number): boolean {
  const ch = db.prepare("SELECT * FROM challenges WHERE id = ?").get(challengeId) as {
    id: string;
    status: string;
    mode: ChallengeMode;
    bet_amount: number;
    duration_hours: number;
    invite_expires_at: number;
    team_size: number;
  };
  if (!ch || ch.status !== "pending") return false;
  if (nowMs > ch.invite_expires_at) {
    db.prepare("UPDATE challenges SET status = 'expired' WHERE id = ?").run(challengeId);
    return false;
  }

  const participants = db
    .prepare("SELECT user_id, team, invite_status FROM challenge_participants WHERE challenge_id = ?")
    .all(challengeId) as Array<{ user_id: string; team: TeamKey; invite_status: string }>;

  const acceptedA = participants.filter((p) => p.team === "A" && p.invite_status === "accepted");
  const acceptedB = participants.filter((p) => p.team === "B" && p.invite_status === "accepted");

  if (acceptedA.length !== ch.team_size || acceptedB.length !== ch.team_size) {
    return false;
  }

  // Verify ALL balances first before reserving any escrow (atomic transaction protects all-or-nothing)
  if (ch.mode === "wager" && ch.bet_amount > 0) {
    for (const p of participants) {
      const acc = requireBankAccount(db, p.user_id);
      if (acc.availableBalance < ch.bet_amount) {
        throw new AppError(
          `تعذر بدء التحدي: رصيد اللاعب ${p.user_id} البنكي أقل من قيمة الرهان (${ch.bet_amount.toLocaleString()}).`,
          400
        );
      }
    }
    for (const p of participants) {
      reserveEscrowInTx(
        db,
        p.user_id,
        ch.bet_amount,
        challengeId,
        `حجز رهان تحدي ${challengeId} (${ch.bet_amount.toLocaleString()} عملة)`
      );
      db.prepare(
        "UPDATE challenge_participants SET bet_reserved = ? WHERE challenge_id = ? AND user_id = ?"
      ).run(ch.bet_amount, challengeId, p.user_id);
    }
  }

  const endsAt = nowMs + ch.duration_hours * 3600 * 1000;
  db.prepare(
    "UPDATE challenges SET status = 'active', started_at = ?, ends_at = ? WHERE id = ?"
  ).run(nowMs, endsAt, challengeId);
  return true;
}

export function respondToChallengeInvite(
  db: DatabaseSync,
  challengeId: string,
  userId: string,
  decision: "accept" | "decline",
  nowMs = Date.now()
) {
  return withTransaction(db, () => {
    const ch = db.prepare("SELECT * FROM challenges WHERE id = ?").get(challengeId) as
      | { id: string; status: string; invite_expires_at: number }
      | undefined;
    if (!ch) throw new AppError("التحدي غير موجود.", 404);
    if (ch.status !== "pending") {
      throw new AppError("هذا التحدي لم يعد في مرحلة الدعوات.", 400);
    }
    if (nowMs > ch.invite_expires_at) {
      db.prepare("UPDATE challenges SET status = 'expired' WHERE id = ?").run(challengeId);
      throw new AppError("انتهت مهلة قبول الدعوات (24 ساعة).", 400);
    }

    const part = db
      .prepare("SELECT * FROM challenge_participants WHERE challenge_id = ? AND user_id = ?")
      .get(challengeId, userId) as { invite_status: string } | undefined;
    if (!part) throw new AppError("أنت لست ضمن قائمة مدعوي هذا التحدي.", 403);
    if (part.invite_status !== "pending") {
      throw new AppError("تم الرد على هذه الدعوة مسبقاً.", 400);
    }

    db.prepare(
      "UPDATE challenge_participants SET invite_status = ? WHERE challenge_id = ? AND user_id = ?"
    ).run(decision === "accept" ? "accepted" : "declined", challengeId, userId);

    if (decision === "accept") {
      tryStartChallengeInTx(db, challengeId, nowMs);
    }

    return getChallengeForViewer(db, challengeId, userId);
  });
}

export function substituteChallengePlayer(
  db: DatabaseSync,
  params: {
    challengeId: string;
    creatorId: string;
    outgoingUserId: string;
    incomingUserId: string;
    nowMs?: number;
  }
) {
  const now = params.nowMs ?? Date.now();
  return withTransaction(db, () => {
    const ch = db.prepare("SELECT * FROM challenges WHERE id = ?").get(params.challengeId) as
      | { id: string; creator_id: string; status: string; invite_expires_at: number }
      | undefined;
    if (!ch) throw new AppError("التحدي غير موجود.", 404);
    if (ch.creator_id !== params.creatorId) {
      throw new AppError("فقط منشئ التحدي يمكنه استبدال اللاعبين قبل البداية.", 403);
    }
    if (ch.status !== "pending") {
      throw new AppError("لا يمكن استبدال اللاعبين بعد بدء التحدي.", 400);
    }
    if (now > ch.invite_expires_at) {
      db.prepare("UPDATE challenges SET status = 'expired' WHERE id = ?").run(ch.id);
      throw new AppError("انتهت مهلة الدعوات الأصلية للتحدي.", 400);
    }

    const outgoing = db
      .prepare("SELECT team FROM challenge_participants WHERE challenge_id = ? AND user_id = ?")
      .get(ch.id, params.outgoingUserId) as { team: TeamKey } | undefined;
    if (!outgoing) throw new AppError("اللاعب المطلوب استبداله غير موجود في التحدي.", 404);

    requireRegisteredUser(db, params.incomingUserId);
    requireBankAccount(db, params.incomingUserId);
    assertNoActiveChallenge(db, params.incomingUserId);

    db.prepare("DELETE FROM challenge_participants WHERE challenge_id = ? AND user_id = ?").run(
      ch.id,
      params.outgoingUserId
    );
    db.prepare(
      `INSERT INTO challenge_participants (
        challenge_id, user_id, team, invite_status, bet_reserved, verified_minutes, payout_amount, joined_at
      ) VALUES (?, ?, ?, 'pending', 0, 0, 0, ?)`
    ).run(ch.id, params.incomingUserId, outgoing.team, new Date(now).toISOString());

    return getChallengeForViewer(db, ch.id, params.creatorId);
  });
}

export function withdrawFromChallenge(
  db: DatabaseSync,
  challengeId: string,
  userId: string
) {
  return withTransaction(db, () => {
    const ch = db.prepare("SELECT * FROM challenges WHERE id = ?").get(challengeId) as
      | { id: string; status: string }
      | undefined;
    if (!ch) throw new AppError("التحدي غير موجود.", 404);
    const part = db
      .prepare("SELECT invite_status FROM challenge_participants WHERE challenge_id = ? AND user_id = ?")
      .get(challengeId, userId) as { invite_status: string } | undefined;
    if (!part) throw new AppError("أنت لست مشاركاً في هذا التحدي.", 404);

    if (ch.status === "pending") {
      db.prepare(
        "UPDATE challenge_participants SET invite_status = 'withdrawn' WHERE challenge_id = ? AND user_id = ?"
      ).run(challengeId, userId);
      return { status: "withdrawn_before_start", message: "تم الانسحاب قبل بدء التحدي (يمكن للمنشئ استبدالك)." };
    }

    if (ch.status === "active") {
      // Post-start withdrawal: match continues, player keeps earned minutes so far, no refund
      db.prepare(
        "UPDATE challenge_participants SET invite_status = 'withdrawn' WHERE challenge_id = ? AND user_id = ?"
      ).run(challengeId, userId);
      return {
        status: "withdrawn_during_match",
        message: "تم تسجيل انسحابك. تستمر المنافسة وتبقى دقائقك الموثقة السابقة محفوظة.",
      };
    }

    throw new AppError("التحدي منتهٍ أو ملغى بالفعل.", 400);
  });
}

export function settleChallenge(
  db: DatabaseSync,
  challengeId: string,
  options: { forceNowMs?: number } = {}
) {
  const now = options.forceNowMs ?? Date.now();
  return withTransaction(db, () => {
    const ch = db.prepare("SELECT * FROM challenges WHERE id = ?").get(challengeId) as
      | {
          id: string;
          mode: ChallengeMode;
          team_size: number;
          bet_amount: number;
          duration_hours: number;
          status: string;
          ends_at: number;
        }
      | undefined;
    if (!ch) throw new AppError("التحدي غير موجود.", 404);
    if (ch.status === "frozen") {
      throw new AppError("التحدي مجمد للمراجعة الإدارية ولا يمكن تسويته حالياً.", 400);
    }
    if (ch.status !== "active") {
      throw new AppError("التحدي ليس نشطاً للتسوية.", 400);
    }
    if (now < ch.ends_at) {
      throw new AppError("لم ينتهِ وقت التحدي بعد.", 400);
    }

    const parts = db
      .prepare(
        "SELECT user_id, team, bet_reserved, verified_minutes FROM challenge_participants WHERE challenge_id = ?"
      )
      .all(challengeId) as Array<{
      user_id: string;
      team: TeamKey;
      bet_reserved: number;
      verified_minutes: number;
    }>;

    const sumA = parts
      .filter((p) => p.team === "A")
      .reduce((acc, p) => acc + p.verified_minutes, 0);
    const sumB = parts
      .filter((p) => p.team === "B")
      .reduce((acc, p) => acc + p.verified_minutes, 0);

    const winnerTeam: "A" | "B" | "tie" = sumA > sumB ? "A" : sumB > sumA ? "B" : "tie";

    if (ch.mode === "wager") {
      const totalPot = parts.reduce((acc, p) => acc + p.bet_reserved, 0);
      if (winnerTeam === "tie") {
        for (const p of parts) {
          releaseEscrowRefundInTx(
            db,
            p.user_id,
            p.bet_reserved,
            challengeId,
            `استرداد رهان التحدي ${challengeId} نتيجة التعادل`
          );
          db.prepare(
            "UPDATE challenge_participants SET payout_amount = ? WHERE challenge_id = ? AND user_id = ?"
          ).run(p.bet_reserved, challengeId, p.user_id);
        }
      } else {
        for (const p of parts) {
          consumeReservedEscrowInTx(
            db,
            p.user_id,
            p.bet_reserved,
            challengeId,
            `تسوية رهان التحدي ${challengeId}`
          );
        }
        const winners = parts.filter((p) => p.team === winnerTeam);
        const share = Math.floor(totalPot / winners.length);
        for (const w of winners) {
          applyIncomeWithLoanRepaymentInTx(db, {
            userId: w.user_id,
            grossAmount: share,
            txType: "challenge_win",
            sourceType: "challenge",
            referenceId: challengeId,
            description: `جائزة الفوز بتحدي ${challengeId} (مجموع الرهانات بدون عمولة)`,
          });
          db.prepare(
            "UPDATE challenge_participants SET payout_amount = ? WHERE challenge_id = ? AND user_id = ?"
          ).run(share, challengeId, w.user_id);
        }
      }
    } else if (
      ch.mode === "free" &&
      SYSTEM_CONFIG.FREE_CHALLENGE_REWARDS_ENABLED &&
      winnerTeam !== "tie"
    ) {
      const rawReward = ch.duration_hours * SYSTEM_CONFIG.FREE_CHALLENGE_BASE_REWARD_PER_HOUR;
      const cappedReward = Math.min(SYSTEM_CONFIG.FREE_CHALLENGE_MAX_REWARD_CAP, rawReward);
      const winners = parts.filter((p) => p.team === winnerTeam);
      for (const w of winners) {
        if (w.verified_minutes > 0 && cappedReward > 0) {
          applyIncomeWithLoanRepaymentInTx(db, {
            userId: w.user_id,
            grossAmount: cappedReward,
            txType: "free_challenge_reward",
            sourceType: "free_challenge",
            referenceId: challengeId,
            description: `مكافأة تحدي مجاني ${challengeId} (ضمن السقف الإداري)`,
          });
          db.prepare(
            "UPDATE challenge_participants SET payout_amount = ? WHERE challenge_id = ? AND user_id = ?"
          ).run(cappedReward, challengeId, w.user_id);
        }
      }
    }

    db.prepare(
      "UPDATE challenges SET status = 'completed', winner_team = ? WHERE id = ?"
    ).run(winnerTeam, challengeId);

    return { challengeId, winnerTeam, sumA, sumB };
  });
}

export function freezeChallengeAdmin(
  db: DatabaseSync,
  actorId: string,
  challengeId: string,
  reason: string
) {
  return withTransaction(db, () => {
    requireAdmin(db, actorId);
    const ch = db.prepare("SELECT status FROM challenges WHERE id = ?").get(challengeId) as
      | { status: string }
      | undefined;
    if (!ch) throw new AppError("التحدي غير موجود.", 404);
    if (ch.status !== "active") throw new AppError("يمكن تجميد التحديات النشطة فقط.", 400);
    db.prepare("UPDATE challenges SET status = 'frozen', freeze_reason = ? WHERE id = ?").run(
      reason.trim() || "مراجعة عدالة النتائج",
      challengeId
    );
    logAudit(db, actorId, "challenge_freeze", reason, challengeId);
    return { ok: true, status: "frozen" };
  });
}

export function cancelChallengeAdmin(
  db: DatabaseSync,
  actorId: string,
  challengeId: string,
  reason: string
) {
  if (!reason.trim()) {
    throw new AppError("يجب كتابة سبب إلغاء التحدي.", 400);
  }
  return withTransaction(db, () => {
    requireAdmin(db, actorId);
    const ch = db.prepare("SELECT status, mode FROM challenges WHERE id = ?").get(challengeId) as
      | { status: string; mode: ChallengeMode }
      | undefined;
    if (!ch) throw new AppError("التحدي غير موجود.", 404);
    if (!["pending", "active", "frozen"].includes(ch.status)) {
      throw new AppError("لا يمكن إلغاء تحدٍ منتهٍ.", 400);
    }

    const parts = db
      .prepare("SELECT user_id, bet_reserved FROM challenge_participants WHERE challenge_id = ?")
      .all(challengeId) as Array<{ user_id: string; bet_reserved: number }>;

    for (const p of parts) {
      if (p.bet_reserved > 0) {
        releaseEscrowRefundInTx(
          db,
          p.user_id,
          p.bet_reserved,
          challengeId,
          `إرجاع الرهان كاملًا بعد إلغاء التحدي ${challengeId}: ${reason}`
        );
      }
    }

    db.prepare(
      "UPDATE challenges SET status = 'cancelled', cancel_reason = ? WHERE id = ?"
    ).run(reason.trim(), challengeId);
    logAudit(db, actorId, "challenge_cancel", reason, challengeId);
    return { ok: true, status: "cancelled" };
  });
}

/**
 * Enforces strict secrecy during active/frozen challenges:
 * A player ONLY sees their own verified minutes — NEVER team totals or opponent scores!
 * After completion/cancellation, full team totals & per-player contributions are revealed.
 */
export function getChallengeForViewer(
  db: DatabaseSync,
  challengeId: string,
  viewerUserId: string
) {
  const ch = db.prepare("SELECT * FROM challenges WHERE id = ?").get(challengeId) as
    | {
        id: string;
        creator_id: string;
        title: string;
        mode: ChallengeMode;
        team_size: number;
        bet_amount: number;
        duration_hours: number;
        status: string;
        invite_expires_at: number;
        started_at: number | null;
        ends_at: number | null;
        winner_team: string | null;
        freeze_reason: string | null;
        cancel_reason: string | null;
        created_at: string;
      }
    | undefined;
  if (!ch) return null;

  const parts = db
    .prepare(
      `SELECT cp.*, u.discord_name
       FROM challenge_participants cp
       JOIN users u ON u.user_id = cp.user_id
       WHERE cp.challenge_id = ?`
    )
    .all(challengeId) as Array<{
    user_id: string;
    discord_name: string;
    team: TeamKey;
    invite_status: string;
    bet_reserved: number;
    verified_minutes: number;
    payout_amount: number;
  }>;

  const isSecretPhase = ch.status === "active" || ch.status === "frozen";

  const participants = parts.map((p) => ({
    userId: p.user_id,
    discordName: p.discord_name,
    team: p.team,
    inviteStatus: p.invite_status,
    // Strict secrecy: hide everyone else's minutes while active/frozen!
    verifiedMinutes: isSecretPhase
      ? p.user_id === viewerUserId
        ? p.verified_minutes
        : null
      : p.verified_minutes,
    payoutAmount: isSecretPhase ? null : p.payout_amount,
  }));

  const teamATotal = isSecretPhase
    ? null
    : parts.filter((p) => p.team === "A").reduce((s, p) => s + p.verified_minutes, 0);
  const teamBTotal = isSecretPhase
    ? null
    : parts.filter((p) => p.team === "B").reduce((s, p) => s + p.verified_minutes, 0);

  return {
    id: ch.id,
    creatorId: ch.creator_id,
    title: ch.title,
    mode: ch.mode,
    teamSize: ch.team_size,
    betAmount: ch.bet_amount,
    durationHours: ch.duration_hours,
    status: ch.status,
    inviteExpiresAt: ch.invite_expires_at,
    startedAt: ch.started_at,
    endsAt: ch.ends_at,
    winnerTeam: isSecretPhase ? null : ch.winner_team,
    freezeReason: ch.freeze_reason,
    cancelReason: ch.cancel_reason,
    isSecretPhase,
    teamATotal,
    teamBTotal,
    participants,
  };
}

export function listChallengesForViewer(db: DatabaseSync, viewerUserId: string) {
  const rows = db
    .prepare("SELECT id FROM challenges ORDER BY created_at DESC LIMIT 30")
    .all() as Array<{ id: string }>;
  return rows.map((r) => getChallengeForViewer(db, r.id, viewerUserId)).filter(Boolean);
}

export function getPlayerChallengeRecord(db: DatabaseSync, userId: string) {
  const rows = db
    .prepare(
      `SELECT c.id, c.status, c.winner_team, cp.team, cp.verified_minutes, cp.payout_amount
       FROM challenge_participants cp
       JOIN challenges c ON c.id = cp.challenge_id
       WHERE cp.user_id = ? AND c.status = 'completed'`
    )
    .all(userId) as Array<{
    id: string;
    status: string;
    winner_team: string;
    team: TeamKey;
    verified_minutes: number;
    payout_amount: number;
  }>;

  let wins = 0;
  let losses = 0;
  let ties = 0;
  let totalVerifiedMinutes = 0;
  let totalCoinsEarned = 0;
  let bestMinutes = 0;

  for (const r of rows) {
    if (r.winner_team === "tie") ties++;
    else if (r.winner_team === r.team) wins++;
    else losses++;
    totalVerifiedMinutes += r.verified_minutes;
    totalCoinsEarned += r.payout_amount;
    if (r.verified_minutes > bestMinutes) bestMinutes = r.verified_minutes;
  }

  return {
    played: rows.length,
    wins,
    losses,
    ties,
    totalVerifiedMinutes,
    totalCoinsEarned,
    bestMinutes,
  };
}
