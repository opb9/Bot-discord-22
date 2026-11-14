import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "../src/database/db";
import { registerPlayer } from "../src/services/registrationService";
import {
  depositAdmin,
  getBankAccount,
  getLedger,
  transferBetweenUsers,
} from "../src/services/bankService";
import {
  applyIncomeWithLoanRepaymentInTx,
  getActiveLoan,
  issueLoan,
  repayLoanManually,
} from "../src/services/loanService";
import { withTransaction } from "../src/database/db";

function createTestDb(name: string) {
  const dbPath = path.join("backups", `test_${name}_${Date.now()}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = openDatabase(dbPath);
  registerPlayer(db, { userId: "u1", discordName: "علي", gender: "male", acceptRules: true });
  registerPlayer(db, { userId: "u2", discordName: "مريم", gender: "female", acceptRules: true });
  return {
    db,
    cleanup: () => {
      db.close();
      for (const suffix of ["", "-wal", "-shm"]) {
        if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
      }
    },
  };
}

test("Registration: blocks duplicate registration and creates mandatory bank account", () => {
  const { db, cleanup } = createTestDb("reg_dup");
  try {
    const acc = getBankAccount(db, "u1");
    assert.ok(acc);
    assert.match(acc.accountNumber, /^SB-/);
    assert.equal(acc.availableBalance, 250); // Registration bonus

    assert.throws(
      () => registerPlayer(db, { userId: "u1", discordName: "علي", gender: "male", acceptRules: true }),
      /مسجل مسبقاً/
    );
  } finally {
    cleanup();
  }
});

test("Bank: atomic transfer, insufficient funds, missing account, idempotency deduplication", () => {
  const { db, cleanup } = createTestDb("bank_transfer");
  try {
    depositAdmin(db, { userId: "u1", amount: 1000, description: "إيداع اختبار" });

    // Idempotent transfer
    const r1 = transferBetweenUsers(db, {
      fromUserId: "u1",
      toUserId: "u2",
      amount: 400,
      idempotencyKey: "tx-key-1",
    });
    const r2 = transferBetweenUsers(db, {
      fromUserId: "u1",
      toUserId: "u2",
      amount: 400,
      idempotencyKey: "tx-key-1",
    });

    assert.equal(r1.fromBalance, 850); // 250 + 1000 - 400
    assert.equal(r1.toBalance, 650); // 250 + 400
    assert.equal(r2.deduplicated, true);
    assert.equal(getBankAccount(db, "u1")?.availableBalance, 850);

    // Insufficient balance
    assert.throws(
      () => transferBetweenUsers(db, { fromUserId: "u1", toUserId: "u2", amount: 5000 }),
      /غير كافٍ/
    );

    // Missing recipient account
    assert.throws(
      () => transferBetweenUsers(db, { fromUserId: "u1", toUserId: "ghost", amount: 10 }),
      /غير موجود/
    );

    const ledger = getLedger(db, "u1", 10);
    assert.ok(ledger.length >= 3);
  } finally {
    cleanup();
  }
});

test("Loans: 3,000-10,000 range, 50% fee, max 1 active, 50% auto-repay, legacy debt untouched", () => {
  const { db, cleanup } = createTestDb("loans");
  try {
    // Insert a legacy debt row that must remain untouched
    db.prepare(
      "INSERT INTO loans (user_id, principal, fee, total_due, remaining_debt, status, created_at) VALUES ('u1', 200, 20, 220, 220, 'legacy', ?)"
    ).run(new Date().toISOString());

    assert.throws(() => issueLoan(db, "u1", 500), /3,000/);
    assert.throws(() => issueLoan(db, "u1", 15000), /10,000/);

    const { loan, availableBalance } = issueLoan(db, "u1", 3000);
    assert.equal(loan.principal, 3000);
    assert.equal(loan.fee, 1500);
    assert.equal(loan.totalDue, 4500);
    assert.equal(loan.remainingDebt, 4500);
    assert.equal(availableBalance, 3250);

    // Second active loan blocked
    assert.throws(() => issueLoan(db, "u1", 3000), /قرض نشط/);

    // Income triggers 50% auto-repayment
    const incomeRes = withTransaction(db, () =>
      applyIncomeWithLoanRepaymentInTx(db, {
        userId: "u1",
        grossAmount: 1000,
        txType: "challenge_win",
        sourceType: "challenge",
        description: "جائزة تحدي",
      })
    );
    assert.equal(incomeRes.repaidAmount, 500);
    assert.equal(incomeRes.netIncome, 500);
    assert.equal(incomeRes.remainingDebt, 4000);

    // Manual repay
    const manual = repayLoanManually(db, "u1", 1000);
    assert.equal(manual.paid, 1000);
    assert.equal(manual.remainingDebt, 3000);

    // Legacy loan remains untouched at 220
    const legacy = db.prepare("SELECT remaining_debt, status FROM loans WHERE status = 'legacy'").get() as {
      remaining_debt: number;
      status: string;
    };
    assert.equal(legacy.remaining_debt, 220);
    assert.ok(getActiveLoan(db, "u1"));
  } finally {
    cleanup();
  }
});
