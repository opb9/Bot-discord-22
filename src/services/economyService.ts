import { DatabaseSync } from "node:sqlite";
import { SYSTEM_CONFIG } from "../config/settings";
import { withTransaction } from "../database/db";
import { AppError, logAudit, requireAdmin, requireRegisteredUser } from "../security/auth";
import { BUILTIN_JOBS, JOB_SALARY } from "../data/botData";
import { getBankAccount } from "./bankService";
import { applyIncomeWithLoanRepaymentInTx } from "./loanService";
import { getLast7DaysMinutes } from "./studyService";

function computeWealthTaxRate(balance: number): number {
  if (balance > 100_000) return 0.15;
  if (balance > 50_000) return 0.10;
  if (balance > 20_000) return 0.05;
  return 0;
}

/**
 * Claims weekly job salary & assigned position salaries directly into the Bank account.
 * Enforces tier-based weekly study quotas & anti-inflation wealth balance fee on high balances.
 */
export function claimSalaries(db: DatabaseSync, userId: string, nowMs = Date.now()) {
  return withTransaction(db, () => {
    const user = requireRegisteredUser(db, userId) as {
      job: string | null;
      last_job_salary_at: number;
    };

    const bank = getBankAccount(db, userId);
    const taxRate = computeWealthTaxRate(bank?.availableBalance ?? 0);

    const lines: string[] = [];
    let totalGross = 0;
    let totalTax = 0;
    let totalRepaid = 0;
    const nowIso = new Date(nowMs).toISOString();

    if (user.job) {
      const intervalMs = SYSTEM_CONFIG.SALARY_INTERVAL_DAYS * 86400 * 1000;
      const elapsed = nowMs - (user.last_job_salary_at || 0);
      const jobMeta = BUILTIN_JOBS[user.job];
      const requiredWeekMins = jobMeta?.requiredWeekMinutes ?? SYSTEM_CONFIG.SALARY_MIN_WEEK_MINUTES;

      if (user.last_job_salary_at > 0 && elapsed < intervalMs) {
        const hrsLeft = Math.ceil((intervalMs - elapsed) / 3600000);
        lines.push(`💼 راتب المهنة: متاح بعد ${hrsLeft} ساعة`);
      } else {
        const weekMins = getLast7DaysMinutes(db, userId);
        if (weekMins < requiredWeekMins) {
          lines.push(
            `💼 راتب المهنة (${jobMeta?.title ?? user.job}): تحتاج ${
              requiredWeekMins - weekMins
            } دقيقة دراسة إضافية خلال آخر 7 أيام (المطلوب: ${requiredWeekMins} د)`
          );
        } else {
          const rawAmount = JOB_SALARY[user.job] ?? SYSTEM_CONFIG.DEFAULT_JOB_SALARY;
          const tax = Math.floor(rawAmount * taxRate);
          const amount = Math.max(1, rawAmount - tax);
          const periodKey = `week_${Math.floor(nowMs / intervalMs)}`;
          const claimRes = db
            .prepare(
              `INSERT OR IGNORE INTO salary_claims (user_id, claim_type, reference_key, period_key, amount, claimed_at)
               VALUES (?, 'job', ?, ?, ?, ?)`
            )
            .run(userId, user.job, periodKey, amount, nowIso);

          if (claimRes.changes > 0) {
            db.prepare("UPDATE users SET last_job_salary_at = ? WHERE user_id = ?").run(
              nowMs,
              userId
            );
            const res = applyIncomeWithLoanRepaymentInTx(db, {
              userId,
              grossAmount: amount,
              txType: "salary_job",
              sourceType: "salary",
              referenceId: `job:${user.job}:${periodKey}`,
              description: `راتب المهنة الأسبوعي (${jobMeta?.title ?? user.job})${
                tax > 0 ? ` — بعد ضريبة توازن الاقتصاد ${Math.round(taxRate * 100)}%` : ""
              }`,
            });
            totalGross += amount;
            totalTax += tax;
            totalRepaid += res.repaidAmount;
            lines.push(
              `💼 راتب ${jobMeta?.title ?? user.job}: +${amount.toLocaleString()} (إيداع بنكي${
                tax > 0 ? `، اقتُطع ${tax} ضريبة توازن` : ""
              })`
            );
          }
        }
      }
    } else {
      lines.push("💼 لا تملك مهنة بعد. ادرس 10 دقائق للحصول على شخصية الطالب.");
    }

    const posRows = db
      .prepare(
        `SELECT p.id, p.name, p.salary, p.interval_days, pm.last_claim_ms
         FROM position_members pm
         JOIN positions p ON p.id = pm.position_id
         WHERE pm.user_id = ?`
      )
      .all(userId) as Array<{
      id: number;
      name: string;
      salary: number;
      interval_days: number;
      last_claim_ms: number;
    }>;

    for (const p of posRows) {
      const intervalMs = p.interval_days * 86400 * 1000;
      const elapsed = nowMs - (p.last_claim_ms || 0);
      if (p.last_claim_ms > 0 && elapsed < intervalMs) {
        const hrsLeft = Math.ceil((intervalMs - elapsed) / 3600000);
        lines.push(`🛡️ ${p.name}: بعد ${hrsLeft} ساعة`);
      } else {
        const tax = Math.floor(p.salary * taxRate);
        const netSalary = Math.max(1, p.salary - tax);
        const periodKey = `pos_${p.id}_${Math.floor(nowMs / intervalMs)}`;
        const claimRes = db
          .prepare(
            `INSERT OR IGNORE INTO salary_claims (user_id, claim_type, reference_key, period_key, amount, claimed_at)
             VALUES (?, 'position', ?, ?, ?, ?)`
          )
          .run(userId, String(p.id), periodKey, netSalary, nowIso);

        if (claimRes.changes > 0) {
          db.prepare(
            "UPDATE position_members SET last_claim_ms = ? WHERE user_id = ? AND position_id = ?"
          ).run(nowMs, userId, p.id);
          const res = applyIncomeWithLoanRepaymentInTx(db, {
            userId,
            grossAmount: netSalary,
            txType: "salary_position",
            sourceType: "position_salary",
            referenceId: `pos:${p.id}:${periodKey}`,
            description: `راتب وظيفة ${p.name}${tax > 0 ? ` (بعد ضريبة توازن ${tax})` : ""}`,
          });
          totalGross += netSalary;
          totalTax += tax;
          totalRepaid += res.repaidAmount;
          lines.push(`🛡️ ${p.name}: +${netSalary.toLocaleString()}`);
        }
      }
    }

    if (totalRepaid > 0) {
      lines.push(`💳 خُصم تلقائيًا لسداد القرض: -${totalRepaid.toLocaleString()}`);
    }

    return { ok: true, totalGross, totalTax, totalRepaid, lines };
  });
}

export function createPositionAdmin(
  db: DatabaseSync,
  actorId: string,
  name: string,
  salary: number,
  intervalDays: number
) {
  requireAdmin(db, actorId);
  const cleanName = name.trim();
  if (
    cleanName.length < 2 ||
    cleanName.length > 40 ||
    salary < 1 ||
    salary > 1_000_000 ||
    intervalDays < 1 ||
    intervalDays > 90
  ) {
    throw new AppError(
      "تأكد: الاسم من 2 إلى 40 حرفًا، الراتب من 1 إلى مليون، الأيام من 1 إلى 90.",
      400
    );
  }
  try {
    const res = db
      .prepare("INSERT INTO positions (name, salary, interval_days) VALUES (?, ?, ?)")
      .run(cleanName, salary, intervalDays);
    logAudit(db, actorId, "position_create", `إنشاء وظيفة ${cleanName} (${salary})`);
    return { id: Number(res.lastInsertRowid), name: cleanName, salary, intervalDays };
  } catch {
    throw new AppError("يوجد وظيفة بهذا الاسم مسبقاً.", 409);
  }
}

export function assignPositionAdmin(
  db: DatabaseSync,
  actorId: string,
  positionId: number,
  targetUserId: string,
  action: "give" | "take"
) {
  requireAdmin(db, actorId);
  requireRegisteredUser(db, targetUserId);
  if (action === "give") {
    db.prepare(
      "INSERT OR IGNORE INTO position_members (user_id, position_id, last_claim_ms) VALUES (?, ?, 0)"
    ).run(targetUserId, positionId);
  } else {
    db.prepare("DELETE FROM position_members WHERE user_id = ? AND position_id = ?").run(
      targetUserId,
      positionId
    );
  }
  logAudit(db, actorId, `position_${action}`, `position=${positionId}`, targetUserId);
}

export function createRankAdmin(db: DatabaseSync, actorId: string, name: string, emoji: string) {
  requireAdmin(db, actorId);
  const clean = name.trim();
  if (clean.length < 2 || clean.length > 40) {
    throw new AppError("اسم الرتبة يجب أن يكون بين 2 و40 حرفًا.", 400);
  }
  try {
    const res = db
      .prepare("INSERT INTO ranks (name, emoji) VALUES (?, ?)")
      .run(clean, emoji.trim().slice(0, 8) || "🎖️");
    logAudit(db, actorId, "rank_create", `إنشاء رتبة ${clean}`);
    return { id: Number(res.lastInsertRowid), name: clean, emoji };
  } catch {
    throw new AppError("يوجد رتبة بهذا الاسم.", 409);
  }
}

export function assignRankAdmin(
  db: DatabaseSync,
  actorId: string,
  rankId: number,
  targetUserId: string,
  action: "give" | "take"
) {
  requireAdmin(db, actorId);
  requireRegisteredUser(db, targetUserId);
  if (action === "give") {
    db.prepare(
      "INSERT OR IGNORE INTO user_ranks (user_id, rank_id, awarded_at) VALUES (?, ?, ?)"
    ).run(targetUserId, rankId, new Date().toISOString());
  } else {
    db.prepare("DELETE FROM user_ranks WHERE user_id = ? AND rank_id = ?").run(
      targetUserId,
      rankId
    );
  }
  logAudit(db, actorId, `rank_${action}`, `rank=${rankId}`, targetUserId);
}
