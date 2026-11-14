import { DatabaseSync } from "node:sqlite";
import { SYSTEM_CONFIG } from "../config/settings";
import { withTransaction } from "../database/db";
import { AppError, sanitizeId } from "../security/auth";
import { createBankAccount, creditBankInTx } from "./bankService";

export interface RegisterInput {
  userId: string;
  discordName: string;
  gender: "male" | "female";
  acceptRules: boolean;
  isAdmin?: boolean;
}

export function registerPlayer(db: DatabaseSync, input: RegisterInput) {
  const userId = sanitizeId(input.userId);
  const discordName = String(input.discordName || "").trim();
  if (discordName.length < 2 || discordName.length > 32) {
    throw new AppError("اسم Discord يجب أن يكون بين 2 و32 حرفًا.", 400);
  }
  if (input.gender !== "male" && input.gender !== "female") {
    throw new AppError("اختيار الجنس إلزامي (ذكر أو أنثى).", 400);
  }
  if (!input.acceptRules) {
    throw new AppError("يجب الموافقة على قوانين المجتمع لإتمام التسجيل.", 400);
  }

  return withTransaction(db, () => {
    const existing = db
      .prepare("SELECT registered FROM users WHERE user_id = ?")
      .get(userId) as { registered: number } | undefined;
    if (existing && Number(existing.registered) === 1) {
      throw new AppError("أنت مسجل مسبقاً. لا يمكن إنشاء حساب مكرر لنفس المعرف.", 409);
    }

    const now = new Date().toISOString();
    if (!existing) {
      db.prepare(
        `INSERT INTO users (
          user_id, discord_name, gender, rules_accepted, registered, registered_at, is_admin, created_at
        ) VALUES (?, ?, ?, 1, 1, ?, ?, ?)`
      ).run(userId, discordName, input.gender, now, input.isAdmin ? 1 : 0, now);
    } else {
      db.prepare(
        `UPDATE users SET discord_name = ?, gender = ?, rules_accepted = 1,
         registered = 1, registered_at = ? WHERE user_id = ?`
      ).run(discordName, input.gender, now, userId);
    }

    const bankAccount = createBankAccount(db, userId);

    const bonus = Number(
      (
        db
          .prepare("SELECT value FROM settings WHERE key = 'registration_bonus'")
          .get() as { value: string } | undefined
      )?.value ?? SYSTEM_CONFIG.REGISTRATION_BONUS
    );

    let balance = bankAccount.availableBalance;
    if (bonus > 0) {
      const updated = creditBankInTx(db, {
        userId,
        amount: bonus,
        txType: "registration_bonus",
        description: `مكافأة التسجيل الترحيبية (${bonus.toLocaleString()} عملة)`,
        idempotencyKey: `reg_bonus:${userId}`,
      });
      balance = updated.availableBalance;
    }

    return {
      ok: true,
      userId,
      discordName,
      gender: input.gender,
      accountNumber: bankAccount.accountNumber,
      bonusGranted: bonus,
      availableBalance: balance,
    };
  });
}
