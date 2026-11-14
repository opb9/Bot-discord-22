import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "../src/database/db";
import { getIraqDateString } from "../src/config/settings";
import { registerPlayer } from "../src/services/registrationService";
import { depositAdmin, getBankAccount } from "../src/services/bankService";
import { addStudyRoom, joinStudyRoom, leaveStudyRoom } from "../src/services/studyService";
import { buyProduct, seedDefaultProducts } from "../src/services/shopService";
import {
  buyStreakShield,
  claimDailyQuest,
  createSubject,
  getEngagementSummary,
  openDailyFocusChest,
  protectMissedYesterdayWithShield,
} from "../src/services/studentEngagementService";

function createTestDb(name: string) {
  const dbPath = path.join("backups", `test_${name}_${Date.now()}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = openDatabase(dbPath);
  seedDefaultProducts(db);
  addStudyRoom(db, "r1", "غرفة التركيز");
  registerPlayer(db, { userId: "u1", discordName: "زينب", gender: "female", acceptRules: true });
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

test("Engagement: Pomodoro bonus, subject minute logging, quests, and mystery chest", () => {
  const { db, cleanup } = createTestDb("eng_quests");
  try {
    const sub = createSubject(db, {
      userId: "u1",
      name: "الفيزياء",
      examDate: "2026-12-01",
    });

    // Chest locked before 30m
    assert.throws(() => openDailyFocusChest(db, "u1", 0.5), /30 دقيقة/);

    const t0 = 1_700_000_000_000;
    joinStudyRoom(db, {
      userId: "u1",
      roomId: "r1",
      screenSharing: true,
      subjectId: sub.id,
      pomodoroTarget: 25,
      nowMs: t0,
    });
    const settled = leaveStudyRoom(db, "u1", t0 + 30 * 60_000);
    assert.equal(settled.regularMinutes, 30);
    assert.equal(settled.pomodoroBonus, 15);

    const summary = getEngagementSummary(db, "u1");
    assert.equal(summary.pomodoroCount, 1);
    assert.equal(summary.subjects[0].loggedMinutes, 30);

    // Warmup quest (25m) should be completed and claimable once
    const q = claimDailyQuest(db, "u1", "warmup_25");
    assert.equal(q.coins, 40);
    assert.throws(() => claimDailyQuest(db, "u1", "warmup_25"), /بالفعل/);

    // Mystery chest unlocks at 30m+ and blocks double-open
    const chest = openDailyFocusChest(db, "u1", 0.5);
    assert.ok(chest.coins >= 60);
    assert.throws(() => openDailyFocusChest(db, "u1", 0.5), /بالفعل/);
  } finally {
    cleanup();
  }
});

test("Engagement: Streak shield saves missed yesterday and preserves streak", () => {
  const { db, cleanup } = createTestDb("eng_shield");
  try {
    depositAdmin(db, { userId: "u1", amount: 1000, description: "رصيد اختبار" });
    const shieldRes = buyStreakShield(db, "u1");
    assert.equal(shieldRes.streakShields, 1);

    // Seed studied day-before-yesterday and today, missing yesterday
    db.prepare(
      "INSERT INTO study_daily_log (user_id, day, regular_minutes, verified_minutes) VALUES ('u1', ?, 40, 20)"
    ).run(getIraqDateString(2));
    db.prepare(
      "INSERT INTO study_daily_log (user_id, day, regular_minutes, verified_minutes) VALUES ('u1', ?, 30, 10)"
    ).run(getIraqDateString(0));

    let summary = getEngagementSummary(db, "u1");
    assert.equal(summary.streak, 1);

    const saved = protectMissedYesterdayWithShield(db, "u1");
    assert.equal(saved.newStreak, 3);

    summary = getEngagementSummary(db, "u1");
    assert.equal(summary.streak, 3);
    assert.equal(summary.streakMultiplier, 1.25);
    assert.equal(summary.streakShields, 0);
  } finally {
    cleanup();
  }
});

test("Engagement: 5+ study hours unlock permanent 5% shop discount", () => {
  const { db, cleanup } = createTestDb("eng_discount");
  try {
    depositAdmin(db, { userId: "u1", amount: 100000, description: "رصيد" });
    db.prepare("UPDATE users SET minutes = 300 WHERE user_id = 'u1'").run();

    const before = getBankAccount(db, "u1")!.availableBalance;
    const buy = buyProduct(db, { userId: "u1", productId: "luffy" }); // 50,000 base -> 47,500 after 5%
    assert.equal(buy.discountPct, 5);
    assert.equal(buy.pricePaid, 47500);
    assert.equal(getBankAccount(db, "u1")!.availableBalance, before - 47500);
  } finally {
    cleanup();
  }
});
