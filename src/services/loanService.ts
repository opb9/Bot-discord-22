import { DatabaseSync } from "node:sqlite";
import { SYSTEM_CONFIG } from "../config/settings";
import { withTransaction } from "../database/db";
import { AppError } from "../security/auth";
import { creditBankInTx, debitBankInTx, requireBankAccount } from "./bankService";

export interface LoanRecord {
  id: number;
  userId: string;
  principal: number;
  fee: number;
  totalDue: number;
  remainingDebt: number;
  status: "active" | "paid" | "legacy";
  createdAt: string;
  paidAt: string | null;
}

export function getActiveLoan(db: DatabaseSync, userId: string): LoanRecord | null {
  const row = db
    .prepare(
      `SELECT id, user_id, principal, fee, total_due, remaining_debt, status, created_at, paid_at
       FROM loans WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`
    )
    .get(userId) as
    | {
        id: number;
        user_id: string;
        principal: number;
        fee: number;
        total_due: number;
        remaining_debt: number;
        status: "active" | "paid" | "legacy";
        created_at: string;
        paid_at: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    principal: row.principal,
    fee: row.fee,
    totalDue: row.total_due,
    remainingDebt: row.remaining_debt,
    status: row.status,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

export function getLoanHistory(db: DatabaseSync, userId: string): LoanRecord[] {
  const rows = db
    .prepare(
      `SELECT id, user_id, principal, fee, total_due, remaining_debt, status, created_at, paid_at
       FROM loans WHERE user_id = ? ORDER BY id DESC LIMIT 20`
    )
    .all(userId) as Array<{
    id: number;
    user_id: string;
    principal: number;
    fee: number;
    total_due: number;
    remaining_debt: number;
    status: "active" | "paid" | "legacy";
    created_at: string;
    paid_at: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    principal: row.principal,
    fee: row.fee,
    totalDue: row.total_due,
    remainingDebt: row.remaining_debt,
    status: row.status,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  }));
}

export function issueLoan(
  db: DatabaseSync,
  userId: string,
  principal: number,
  idempotencyKey?: string
): { loan: LoanRecord; availableBalance: number } {
  if (
    !Number.isInteger(principal) ||
    principal < SYSTEM_CONFIG.LOAN_MIN ||
    principal > SYSTEM_CONFIG.LOAN_MAX
  ) {
    throw new AppError(
      `مبلغ القرض يجب أن يكون بين ${SYSTEM_CONFIG.LOAN_MIN.toLocaleString()} و${SYSTEM_CONFIG.LOAN_MAX.toLocaleString()}.`,
      400
    );
  }

  return withTransaction(db, () => {
    if (idempotencyKey) {
      const seen = db
        .prepare("SELECT response_json FROM idempotency_keys WHERE key = ?")
        .get(idempotencyKey) as { response_json: string } | undefined;
      if (seen) return JSON.parse(seen.response_json);
    }

    requireBankAccount(db, userId);
    const active = getActiveLoan(db, userId);
    if (active) {
      throw new AppError("لديك قرض نشط حالياً. يجب سداده قبل طلب قرض جديد.", 400);
    }

    const fee = Math.ceil(principal * SYSTEM_CONFIG.LOAN_FEE_RATE);
    const totalDue = principal + fee;
    const now = new Date().toISOString();

    const insertRes = db
      .prepare(
        `INSERT INTO loans (user_id, principal, fee, total_due, remaining_debt, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`
      )
      .run(userId, principal, fee, totalDue, totalDue, now);

    const loanId = Number(insertRes.lastInsertRowid);

    const acc = creditBankInTx(db, {
      userId,
      amount: principal,
      txType: "loan_disbursement",
      referenceId: `loan:${loanId}`,
      description: `صرف قرض بقيمة ${principal.toLocaleString()} (إجمالي المستحق ${totalDue.toLocaleString()})`,
    });

    const loan = getActiveLoan(db, userId)!;
    const result = { loan, availableBalance: acc.availableBalance };

    if (idempotencyKey) {
      db.prepare(
        "INSERT INTO idempotency_keys (key, operation, response_json, created_at) VALUES (?, 'loan_issue', ?, ?)"
      ).run(idempotencyKey, JSON.stringify(result), now);
    }
    return result;
  });
}

/**
 * Credits income to the user's Bank account and automatically deducts 50% toward any active loan
 * (ignoring legacy loans, which remain preserved without collection).
 */
export function applyIncomeWithLoanRepaymentInTx(
  db: DatabaseSync,
  params: {
    userId: string;
    grossAmount: number;
    txType: string;
    sourceType: string;
    referenceId?: string;
    description: string;
  }
): { grossIncome: number; repaidAmount: number; netIncome: number; remainingDebt: number } {
  if (params.grossAmount <= 0) {
    return { grossIncome: 0, repaidAmount: 0, netIncome: 0, remainingDebt: 0 };
  }

  // First credit the gross income to the bank
  creditBankInTx(db, {
    userId: params.userId,
    amount: params.grossAmount,
    txType: params.txType,
    referenceId: params.referenceId,
    description: params.description,
  });

  const active = getActiveLoan(db, params.userId);
  if (!active || active.remainingDebt <= 0) {
    return {
      grossIncome: params.grossAmount,
      repaidAmount: 0,
      netIncome: params.grossAmount,
      remainingDebt: 0,
    };
  }

  const targetRepay = Math.max(
    1,
    Math.ceil(params.grossAmount * SYSTEM_CONFIG.LOAN_AUTO_REPAY_SHARE)
  );
  const repaid = Math.min(active.remainingDebt, targetRepay, params.grossAmount);
  const netIncome = params.grossAmount - repaid;
  const debtAfter = active.remainingDebt - repaid;
  const now = new Date().toISOString();

  debitBankInTx(db, {
    userId: params.userId,
    amount: repaid,
    txType: "loan_auto_repay",
    referenceId: `loan:${active.id}`,
    description: `سداد تلقائي للقرض (${params.sourceType}) — الأصلي ${params.grossAmount.toLocaleString()}، الخصم ${repaid.toLocaleString()}، الصافي ${netIncome.toLocaleString()}`,
  });

  db.prepare(
    "UPDATE loans SET remaining_debt = ?, status = ?, paid_at = ? WHERE id = ?"
  ).run(debtAfter, debtAfter === 0 ? "paid" : "active", debtAfter === 0 ? now : null, active.id);

  db.prepare(
    `INSERT INTO loan_repayments (
      loan_id, user_id, source_type, gross_income, repaid_amount, net_income, debt_after, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    active.id,
    params.userId,
    params.sourceType,
    params.grossAmount,
    repaid,
    netIncome,
    debtAfter,
    now
  );

  return {
    grossIncome: params.grossAmount,
    repaidAmount: repaid,
    netIncome,
    remainingDebt: debtAfter,
  };
}

export function repayLoanManually(
  db: DatabaseSync,
  userId: string,
  amount: number,
  idempotencyKey?: string
): { paid: number; remainingDebt: number; availableBalance: number } {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AppError("مبلغ السداد غير صالح.", 400);
  }
  return withTransaction(db, () => {
    if (idempotencyKey) {
      const seen = db
        .prepare("SELECT response_json FROM idempotency_keys WHERE key = ?")
        .get(idempotencyKey) as { response_json: string } | undefined;
      if (seen) return JSON.parse(seen.response_json);
    }

    const active = getActiveLoan(db, userId);
    if (!active || active.remainingDebt <= 0) {
      throw new AppError("لا يوجد عليك قرض نشط.", 400);
    }
    const acc = requireBankAccount(db, userId);
    const pay = Math.min(amount, active.remainingDebt, acc.availableBalance);
    if (pay <= 0) {
      throw new AppError("رصيدك البنكي المتاح لا يكفي للسداد.", 400);
    }

    const updatedAcc = debitBankInTx(db, {
      userId,
      amount: pay,
      txType: "loan_manual_repay",
      referenceId: `loan:${active.id}`,
      description: `سداد يدوي للقرض بمبلغ ${pay.toLocaleString()}`,
    });

    const debtAfter = active.remainingDebt - pay;
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE loans SET remaining_debt = ?, status = ?, paid_at = ? WHERE id = ?"
    ).run(debtAfter, debtAfter === 0 ? "paid" : "active", debtAfter === 0 ? now : null, active.id);

    db.prepare(
      `INSERT INTO loan_repayments (
        loan_id, user_id, source_type, gross_income, repaid_amount, net_income, debt_after, created_at
      ) VALUES (?, ?, 'manual', 0, ?, 0, ?, ?)`
    ).run(active.id, userId, pay, debtAfter, now);

    const result = {
      paid: pay,
      remainingDebt: debtAfter,
      availableBalance: updatedAcc.availableBalance,
    };

    if (idempotencyKey) {
      db.prepare(
        "INSERT INTO idempotency_keys (key, operation, response_json, created_at) VALUES (?, 'loan_repay', ?, ?)"
      ).run(idempotencyKey, JSON.stringify(result), now);
    }
    return result;
  });
}
