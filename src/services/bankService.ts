import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { withTransaction } from "../database/db";
import { AppError } from "../security/auth";

export interface BankAccount {
  userId: string;
  accountNumber: string;
  availableBalance: number;
  reservedBalance: number;
  createdAt: string;
}

export interface LedgerEntry {
  id: number;
  txId: string;
  userId: string;
  txType: string;
  amount: number;
  balanceAfter: number;
  reservedAfter: number;
  relatedUserId: string | null;
  referenceId: string | null;
  description: string;
  createdAt: string;
}

function generateAccountNumber(userId: string): string {
  const hash = crypto.createHash("sha256").update(userId).digest("hex").slice(0, 8).toUpperCase();
  return `SB-${hash}`;
}

export function getBankAccount(db: DatabaseSync, userId: string): BankAccount | null {
  const row = db
    .prepare(
      "SELECT user_id, account_number, available_balance, reserved_balance, created_at FROM bank_accounts WHERE user_id = ?"
    )
    .get(userId) as
    | {
        user_id: string;
        account_number: string;
        available_balance: number;
        reserved_balance: number;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    userId: row.user_id,
    accountNumber: row.account_number,
    availableBalance: row.available_balance,
    reservedBalance: row.reserved_balance,
    createdAt: row.created_at,
  };
}

export function requireBankAccount(db: DatabaseSync, userId: string): BankAccount {
  const acc = getBankAccount(db, userId);
  if (!acc) {
    throw new AppError("الحساب البنكي غير موجود. يرجى إكمال التسجيل أولاً.", 404);
  }
  return acc;
}

export function createBankAccount(db: DatabaseSync, userId: string): BankAccount {
  const existing = getBankAccount(db, userId);
  if (existing) return existing;
  const accNum = generateAccountNumber(userId);
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO bank_accounts (user_id, account_number, available_balance, reserved_balance, created_at) VALUES (?, ?, 0, 0, ?)"
  ).run(userId, accNum, now);
  return {
    userId,
    accountNumber: accNum,
    availableBalance: 0,
    reservedBalance: 0,
    createdAt: now,
  };
}

function checkIdempotency<T>(db: DatabaseSync, key: string | undefined): T | null {
  if (!key) return null;
  const row = db
    .prepare("SELECT response_json FROM idempotency_keys WHERE key = ?")
    .get(key) as { response_json: string } | undefined;
  return row ? (JSON.parse(row.response_json) as T) : null;
}

function saveIdempotency(db: DatabaseSync, key: string | undefined, operation: string, res: unknown) {
  if (!key) return;
  db.prepare(
    "INSERT INTO idempotency_keys (key, operation, response_json, created_at) VALUES (?, ?, ?, ?)"
  ).run(key, operation, JSON.stringify(res), new Date().toISOString());
}

export function appendLedger(
  db: DatabaseSync,
  params: {
    userId: string;
    txType: string;
    amount: number;
    balanceAfter: number;
    reservedAfter: number;
    relatedUserId?: string | null;
    referenceId?: string | null;
    description: string;
    idempotencyKey?: string;
  }
): string {
  const txId = `TX-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  db.prepare(
    `INSERT INTO bank_ledger (
      tx_id, user_id, tx_type, amount, balance_after, reserved_after,
      related_user_id, reference_id, description, idempotency_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    txId,
    params.userId,
    params.txType,
    params.amount,
    params.balanceAfter,
    params.reservedAfter,
    params.relatedUserId ?? null,
    params.referenceId ?? null,
    params.description,
    params.idempotencyKey ?? null,
    new Date().toISOString()
  );
  // Keep users.coins synchronized as a display mirror only; bank_accounts is authoritative
  db.prepare("UPDATE users SET coins = ? WHERE user_id = ?").run(params.balanceAfter, params.userId);
  return txId;
}

export function creditBankInTx(
  db: DatabaseSync,
  params: {
    userId: string;
    amount: number;
    txType: string;
    description: string;
    relatedUserId?: string;
    referenceId?: string;
    idempotencyKey?: string;
  }
): BankAccount {
  if (!Number.isInteger(params.amount) || params.amount <= 0) {
    throw new AppError("مبلغ الإيداع يجب أن يكون رقمًا صحيحًا موجبًا.", 400);
  }
  const acc = requireBankAccount(db, params.userId);
  const newBalance = acc.availableBalance + params.amount;
  db.prepare("UPDATE bank_accounts SET available_balance = ? WHERE user_id = ?").run(
    newBalance,
    params.userId
  );
  appendLedger(db, {
    userId: params.userId,
    txType: params.txType,
    amount: params.amount,
    balanceAfter: newBalance,
    reservedAfter: acc.reservedBalance,
    relatedUserId: params.relatedUserId,
    referenceId: params.referenceId,
    description: params.description,
    idempotencyKey: params.idempotencyKey,
  });
  return { ...acc, availableBalance: newBalance };
}

export function debitBankInTx(
  db: DatabaseSync,
  params: {
    userId: string;
    amount: number;
    txType: string;
    description: string;
    relatedUserId?: string;
    referenceId?: string;
    idempotencyKey?: string;
  }
): BankAccount {
  if (!Number.isInteger(params.amount) || params.amount <= 0) {
    throw new AppError("مبلغ الخصم يجب أن يكون رقمًا صحيحًا موجبًا.", 400);
  }
  const acc = requireBankAccount(db, params.userId);
  if (acc.availableBalance < params.amount) {
    throw new AppError(
      `رصيد البنك غير كافٍ. المطلوب ${params.amount.toLocaleString()} والمتاح ${acc.availableBalance.toLocaleString()}.`,
      400
    );
  }
  const newBalance = acc.availableBalance - params.amount;
  db.prepare("UPDATE bank_accounts SET available_balance = ? WHERE user_id = ?").run(
    newBalance,
    params.userId
  );
  appendLedger(db, {
    userId: params.userId,
    txType: params.txType,
    amount: -params.amount,
    balanceAfter: newBalance,
    reservedAfter: acc.reservedBalance,
    relatedUserId: params.relatedUserId,
    referenceId: params.referenceId,
    description: params.description,
    idempotencyKey: params.idempotencyKey,
  });
  return { ...acc, availableBalance: newBalance };
}

export function reserveEscrowInTx(
  db: DatabaseSync,
  userId: string,
  amount: number,
  referenceId: string,
  description: string
): BankAccount {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AppError("مبلغ الحجز غير صالح.", 400);
  }
  const acc = requireBankAccount(db, userId);
  if (acc.availableBalance < amount) {
    throw new AppError(
      `رصيد ${userId} البنكي لا يكفي لحجز الرهان (${amount.toLocaleString()}).`,
      400
    );
  }
  const newAvail = acc.availableBalance - amount;
  const newRes = acc.reservedBalance + amount;
  db.prepare(
    "UPDATE bank_accounts SET available_balance = ?, reserved_balance = ? WHERE user_id = ?"
  ).run(newAvail, newRes, userId);
  appendLedger(db, {
    userId,
    txType: "escrow_reserve",
    amount: -amount,
    balanceAfter: newAvail,
    reservedAfter: newRes,
    referenceId,
    description,
  });
  return { ...acc, availableBalance: newAvail, reservedBalance: newRes };
}

export function releaseEscrowRefundInTx(
  db: DatabaseSync,
  userId: string,
  amount: number,
  referenceId: string,
  description: string
): BankAccount {
  if (amount <= 0) return requireBankAccount(db, userId);
  const acc = requireBankAccount(db, userId);
  if (acc.reservedBalance < amount) {
    throw new AppError("الرصيد المحجوز غير كافٍ للاسترداد.", 500);
  }
  const newAvail = acc.availableBalance + amount;
  const newRes = acc.reservedBalance - amount;
  db.prepare(
    "UPDATE bank_accounts SET available_balance = ?, reserved_balance = ? WHERE user_id = ?"
  ).run(newAvail, newRes, userId);
  appendLedger(db, {
    userId,
    txType: "escrow_refund",
    amount,
    balanceAfter: newAvail,
    reservedAfter: newRes,
    referenceId,
    description,
  });
  return { ...acc, availableBalance: newAvail, reservedBalance: newRes };
}

export function consumeReservedEscrowInTx(
  db: DatabaseSync,
  userId: string,
  amount: number,
  referenceId: string,
  description: string
): BankAccount {
  if (amount <= 0) return requireBankAccount(db, userId);
  const acc = requireBankAccount(db, userId);
  if (acc.reservedBalance < amount) {
    throw new AppError("الرصيد المحجوز غير كافٍ للتسوية.", 500);
  }
  const newRes = acc.reservedBalance - amount;
  db.prepare("UPDATE bank_accounts SET reserved_balance = ? WHERE user_id = ?").run(newRes, userId);
  appendLedger(db, {
    userId,
    txType: "escrow_settle",
    amount: 0,
    balanceAfter: acc.availableBalance,
    reservedAfter: newRes,
    referenceId,
    description,
  });
  return { ...acc, reservedBalance: newRes };
}

export function transferBetweenUsers(
  db: DatabaseSync,
  params: {
    fromUserId: string;
    toUserId: string;
    amount: number;
    note?: string;
    idempotencyKey?: string;
  }
): {
  ok: true;
  amount: number;
  transferFee: number;
  fromBalance: number;
  toBalance: number;
  deduplicated?: boolean;
} {
  if (params.fromUserId === params.toUserId) {
    throw new AppError("لا يمكنك التحويل لنفسك.", 400);
  }
  if (!Number.isInteger(params.amount) || params.amount <= 0) {
    throw new AppError("مبلغ التحويل يجب أن يكون رقمًا صحيحًا أكبر من صفر.", 400);
  }

  return withTransaction(db, () => {
    const cached = checkIdempotency<{
      ok: true;
      amount: number;
      transferFee: number;
      fromBalance: number;
      toBalance: number;
    }>(db, params.idempotencyKey);
    if (cached) {
      return { ...cached, deduplicated: true };
    }

    const transferFee = params.amount >= 5000 ? Math.round(params.amount * 0.03) : 0;
    const totalDebit = params.amount + transferFee;

    const fromAcc = debitBankInTx(db, {
      userId: params.fromUserId,
      amount: totalDebit,
      txType: "transfer_out",
      relatedUserId: params.toUserId,
      description: params.note
        ? `تحويل صادر إلى ${params.toUserId}: ${params.note}${transferFee > 0 ? ` (رسم توازن 3%: ${transferFee})` : ""}`
        : `تحويل صادر إلى ${params.toUserId}${transferFee > 0 ? ` (رسم توازن 3%: ${transferFee})` : ""}`,
    });

    const toAcc = creditBankInTx(db, {
      userId: params.toUserId,
      amount: params.amount,
      txType: "transfer_in",
      relatedUserId: params.fromUserId,
      description: params.note
        ? `تحويل وارد من ${params.fromUserId}: ${params.note}`
        : `تحويل وارد من ${params.fromUserId}`,
    });

    const result = {
      ok: true as const,
      amount: params.amount,
      transferFee,
      fromBalance: fromAcc.availableBalance,
      toBalance: toAcc.availableBalance,
    };
    saveIdempotency(db, params.idempotencyKey, "bank_transfer", result);
    return result;
  });
}

export function depositAdmin(
  db: DatabaseSync,
  params: { userId: string; amount: number; description: string; idempotencyKey?: string }
): BankAccount {
  return withTransaction(db, () => {
    const cached = checkIdempotency<BankAccount>(db, params.idempotencyKey);
    if (cached) return cached;
    const acc = creditBankInTx(db, {
      userId: params.userId,
      amount: params.amount,
      txType: "admin_deposit",
      description: params.description,
    });
    saveIdempotency(db, params.idempotencyKey, "admin_deposit", acc);
    return acc;
  });
}

export function withdrawAdmin(
  db: DatabaseSync,
  params: { userId: string; amount: number; description: string; idempotencyKey?: string }
): BankAccount {
  return withTransaction(db, () => {
    const cached = checkIdempotency<BankAccount>(db, params.idempotencyKey);
    if (cached) return cached;
    const acc = debitBankInTx(db, {
      userId: params.userId,
      amount: params.amount,
      txType: "admin_withdraw",
      description: params.description,
    });
    saveIdempotency(db, params.idempotencyKey, "admin_withdraw", acc);
    return acc;
  });
}

export function getLedger(db: DatabaseSync, userId: string, limit = 30): LedgerEntry[] {
  const rows = db
    .prepare(
      `SELECT id, tx_id, user_id, tx_type, amount, balance_after, reserved_after,
              related_user_id, reference_id, description, created_at
       FROM bank_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(userId, limit) as Array<{
    id: number;
    tx_id: string;
    user_id: string;
    tx_type: string;
    amount: number;
    balance_after: number;
    reserved_after: number;
    related_user_id: string | null;
    reference_id: string | null;
    description: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    txId: r.tx_id,
    userId: r.user_id,
    txType: r.tx_type,
    amount: r.amount,
    balanceAfter: r.balance_after,
    reservedAfter: r.reserved_after,
    relatedUserId: r.related_user_id,
    referenceId: r.reference_id,
    description: r.description,
    createdAt: r.created_at,
  }));
}
