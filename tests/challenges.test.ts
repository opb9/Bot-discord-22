import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "../src/database/db";
import { registerPlayer } from "../src/services/registrationService";
import { depositAdmin, getBankAccount } from "../src/services/bankService";
import {
  cancelChallengeAdmin,
  createChallenge,
  freezeChallengeAdmin,
  getChallengeForViewer,
  respondToChallengeInvite,
  settleChallenge,
  substituteChallengePlayer,
  withdrawFromChallenge,
} from "../src/services/challengeService";
import {
  addStudyRoom,
  joinStudyRoom,
  leaveStudyRoom,
} from "../src/services/studyService";
import { issueLoan } from "../src/services/loanService";

function createTestDb(name: string) {
  const dbPath = path.join("backups", `test_${name}_${Date.now()}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = openDatabase(dbPath);
  addStudyRoom(db, "r1", "غرفة التحدي");
  for (const [id, isAdmin] of [
    ["u1", true],
    ["u2", false],
    ["u3", false],
  ] as const) {
    registerPlayer(db, { userId: id, discordName: `User_${id}`, gender: "male", acceptRules: true, isAdmin });
    depositAdmin(db, { userId: id, amount: 2000, description: "رصيد" });
  }
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

test("Challenges: atomic escrow, secrecy during active match, winner payout with loan auto-repay", () => {
  const { db, cleanup } = createTestDb("ch_win");
  try {
    // u1 takes a 3000 loan first (debt = 4500)
    issueLoan(db, "u1", 3000);

    const t0 = 1_700_000_000_000;
    const ch = createChallenge(db, {
      creatorId: "u1",
      title: "تحدي 1 ضد 1",
      mode: "wager",
      teamSize: 1,
      betAmount: 1000,
      durationHours: 2,
      teamAIds: ["u1"],
      teamBIds: ["u2"],
      nowMs: t0,
    })!;

    // Before u2 accepts, escrow must NOT be reserved
    assert.equal(getBankAccount(db, "u1")?.reservedBalance, 0);

    // u2 accepts -> both accounts reserve 1000 atomically
    const started = respondToChallengeInvite(db, ch.id, "u2", "accept", t0 + 10_000)!;
    assert.equal(started.status, "active");
    assert.equal(getBankAccount(db, "u1")?.reservedBalance, 1000);
    assert.equal(getBankAccount(db, "u2")?.reservedBalance, 1000);

    // Neither player can join a second active challenge
    assert.throws(
      () =>
        createChallenge(db, {
          creatorId: "u1",
          title: "ثاني",
          mode: "free",
          teamSize: 1,
          betAmount: 0,
          durationHours: 2,
          teamAIds: ["u1"],
          teamBIds: ["u3"],
          nowMs: t0 + 20_000,
        }),
      /نشط/
    );

    // u1 studies 20 mins with screen share, u2 studies 10 mins with screen share
    joinStudyRoom(db, { userId: "u1", roomId: "r1", screenSharing: true, nowMs: t0 + 60_000 });
    leaveStudyRoom(db, "u1", t0 + 21 * 60_000);

    joinStudyRoom(db, { userId: "u2", roomId: "r1", screenSharing: true, nowMs: t0 + 60_000 });
    leaveStudyRoom(db, "u2", t0 + 11 * 60_000);

    // During active challenge: secrecy enforced! u1 sees ONLY u1's 20 mins, NOT u2's or team totals
    const secretView = getChallengeForViewer(db, ch.id, "u1")!;
    assert.equal(secretView.isSecretPhase, true);
    assert.equal(secretView.teamATotal, null);
    assert.equal(secretView.teamBTotal, null);
    assert.equal(secretView.participants.find((p) => p.userId === "u1")?.verifiedMinutes, 20);
    assert.equal(secretView.participants.find((p) => p.userId === "u2")?.verifiedMinutes, null);

    // Settle after 2 hours
    const settled = settleChallenge(db, ch.id, { forceNowMs: t0 + 3 * 3600_000 });
    assert.equal(settled.winnerTeam, "A");
    assert.equal(settled.sumA, 20);
    assert.equal(settled.sumB, 10);

    // Post-completion reveals totals
    const finalView = getChallengeForViewer(db, ch.id, "u2")!;
    assert.equal(finalView.teamATotal, 20);
    assert.equal(finalView.teamBTotal, 10);

    // u1 won 2000 pot -> 50% (1000) auto-repaid loan!
    const u1Loan = db.prepare("SELECT remaining_debt FROM loans WHERE user_id = 'u1' AND status = 'active'").get() as {
      remaining_debt: number;
    };
    assert.equal(u1Loan.remaining_debt, 3490); // 20 study coins paid 10, 2000 prize paid 1000 -> 4500 - 1010 = 3490
  } finally {
    cleanup();
  }
});

test("Challenges: tie refunds escrow, insufficient balance aborts without partial deduction", () => {
  const { db, cleanup } = createTestDb("ch_tie");
  try {
    const t0 = 1_700_000_000_000;
    // Try bet 10,000 when u1 only has 2,250 -> fails cleanly with 0 reserved
    const chBig = createChallenge(db, {
      creatorId: "u1",
      title: "رهان كبير",
      mode: "wager",
      teamSize: 1,
      betAmount: 10000,
      durationHours: 2,
      teamAIds: ["u1"],
      teamBIds: ["u2"],
      nowMs: t0,
    })!;
    assert.throws(() => respondToChallengeInvite(db, chBig.id, "u2", "accept", t0 + 5000), /أقل من قيمة الرهان/);
    assert.equal(getBankAccount(db, "u1")?.reservedBalance, 0);
    assert.equal(getBankAccount(db, "u2")?.reservedBalance, 0);

    // Substitute u2 -> u3, then admin cancels chBig before creating chTie
    withdrawFromChallenge(db, chBig.id, "u2");
    substituteChallengePlayer(db, {
      challengeId: chBig.id,
      creatorId: "u1",
      outgoingUserId: "u2",
      incomingUserId: "u3",
      nowMs: t0 + 6000,
    });
    cancelChallengeAdmin(db, "u1", chBig.id, "تنظيم تحدٍ جديد");
    // Create clean 1,000 bet challenge between u2 and u3
    const chTie = createChallenge(db, {
      creatorId: "u2",
      title: "تعادل",
      mode: "wager",
      teamSize: 1,
      betAmount: 1000,
      durationHours: 2,
      teamAIds: ["u2"],
      teamBIds: ["u3"],
      nowMs: t0 + 10_000,
    })!;
    respondToChallengeInvite(db, chTie.id, "u3", "accept", t0 + 15_000);
    const settled = settleChallenge(db, chTie.id, { forceNowMs: t0 + 3 * 3600_000 });
    assert.equal(settled.winnerTeam, "tie");
    assert.equal(getBankAccount(db, "u2")?.reservedBalance, 0);
    assert.equal(getBankAccount(db, "u2")?.availableBalance, 2250);
    assert.equal(getBankAccount(db, "u3")?.availableBalance, 2250);
  } finally {
    cleanup();
  }
});

test("Challenges: admin freeze blocks settlement & admin cancel refunds all bets", () => {
  const { db, cleanup } = createTestDb("ch_admin");
  try {
    const t0 = 1_700_000_000_000;
    const ch = createChallenge(db, {
      creatorId: "u1",
      title: "تحدي للمراجعة",
      mode: "wager",
      teamSize: 1,
      betAmount: 500,
      durationHours: 2,
      teamAIds: ["u1"],
      teamBIds: ["u2"],
      nowMs: t0,
    })!;
    respondToChallengeInvite(db, ch.id, "u2", "accept", t0 + 1000);
    freezeChallengeAdmin(db, "u1", ch.id, "فحص السجلات");
    assert.throws(() => settleChallenge(db, ch.id, { forceNowMs: t0 + 3 * 3600_000 }), /مجمد/);

    cancelChallengeAdmin(db, "u1", ch.id, "إلغاء مؤكد مع إرجاع الرهانات");
    assert.equal(getBankAccount(db, "u1")?.reservedBalance, 0);
    assert.equal(getBankAccount(db, "u2")?.reservedBalance, 0);
    assert.equal(getBankAccount(db, "u2")?.availableBalance, 2250);
  } finally {
    cleanup();
  }
});
