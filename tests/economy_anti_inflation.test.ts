import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "../src/database/db";
import { seedInitialEcosystem } from "../src/database/seed";
import { BUILTIN_JOBS, computeStudyReward } from "../src/data/botData";
import { ensureDefaultJobAvatars, resolveAvatarUrl } from "../src/database/avatarGenerator";
import { registerPlayer } from "../src/services/registrationService";
import { depositAdmin, getBankAccount, transferBetweenUsers } from "../src/services/bankService";
import { buyProduct } from "../src/services/shopService";
import { claimSalaries } from "../src/services/economyService";
import { addStudyRoom, joinStudyRoom, leaveStudyRoom } from "../src/services/studyService";
import { createGuild, donateToGuild, upgradeGuildLevel } from "../src/services/guildService";
import { getIraqDateString } from "../src/config/settings";

function createTestDb(name: string) {
  const dbPath = path.join("backups", `test_${name}_${Date.now()}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = openDatabase(dbPath);
  seedInitialEcosystem(db);
  addStudyRoom(db, "r_eco", "غرفة الاقتصاد");
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

test("Careers & Positions: 36 jobs + 12 positions seeded with tier gates and transparent PNGs", () => {
  const { db, cleanup } = createTestDb("careers_seed");
  try {
    const jobKeys = Object.keys(BUILTIN_JOBS);
    assert.ok(jobKeys.length >= 35, `Expected 35+ jobs, got ${jobKeys.length}`);

    const dbJobs = db
      .prepare("SELECT COUNT(*) as c FROM shop_products WHERE kind = 'job'")
      .get() as { c: number };
    assert.equal(dbJobs.c, jobKeys.length);

    const dbPositions = db.prepare("SELECT COUNT(*) as c FROM positions").get() as { c: number };
    assert.ok(dbPositions.c >= 12);

    // Ensure custom user-uploaded programmer_male.png is preserved untouched
    const progMalePath = path.resolve(process.cwd(), "avatars", "programmer_male.png");
    const hashBefore = crypto.createHash("sha256").update(fs.readFileSync(progMalePath)).digest("hex");
    ensureDefaultJobAvatars();
    const hashAfter = crypto.createHash("sha256").update(fs.readFileSync(progMalePath)).digest("hex");
    assert.equal(hashAfter, hashBefore, "programmer_male.png must never be overwritten");

    // Check newly generated transparent PNG exists and resolves dynamically
    assert.equal(resolveAvatarUrl("surgeon", "female"), "/avatars/surgeon_female.png");
    const surgeonPng = fs.readFileSync(path.resolve(process.cwd(), "avatars", "surgeon_female.png"));
    assert.equal(surgeonPng[0], 137);
    assert.equal(surgeonPng[1], 80); // 'P'
    assert.equal(surgeonPng[25], 6); // Color type 6 = RGBA (transparent alpha channel)

    // Check level lock enforcement on Tier 4+ jobs
    registerPlayer(db, { userId: "u_low", discordName: "نور", gender: "female", acceptRules: true });
    depositAdmin(db, { userId: "u_low", amount: 50000, description: "تمويل" });
    assert.throws(
      () => buyProduct(db, { userId: "u_low", productId: "surgeon", variant: "female" }),
      /المستوى/
    );

    // Level up user to Lv.20+ (20,000+ xp -> set 30,000 xp) and buy surgeon
    db.prepare("UPDATE users SET xp = 30000 WHERE user_id = 'u_low'").run();
    const res = buyProduct(db, { userId: "u_low", productId: "surgeon", variant: "female" });
    assert.equal(res.ok, true);
  } finally {
    cleanup();
  }
});

test("Anti-inflation: Diminishing daily study coins, whale transfer fee, wealth tax, and guild sink", () => {
  const { db, cleanup } = createTestDb("anti_inflation");
  try {
    // 1. Study reward curve: 30m fresh = 30, past 180m = 50% (30 + 5 hour bonus = 35), past 360m = 25% (15 + 5 = 20)
    assert.equal(computeStudyReward(30, 0), 30);
    assert.equal(computeStudyReward(60, 180), 35);
    assert.equal(computeStudyReward(60, 360), 20);

    // Verify full session settlement respects alreadyStudiedToday while preserving 1:1 XP
    registerPlayer(db, { userId: "s1", discordName: "حسين", gender: "male", acceptRules: true });
    db.prepare(
      "INSERT INTO study_daily_log (user_id, day, regular_minutes, verified_minutes) VALUES ('s1', ?, 180, 180)"
    ).run(getIraqDateString(0));
    const t0 = 1_700_000_000_000;
    joinStudyRoom(db, { userId: "s1", roomId: "r_eco", nowMs: t0 });
    const settled = leaveStudyRoom(db, "s1", t0 + 60 * 60_000);
    assert.equal(settled.earned, 35, "Coins should drop to 50% (+5 hour bonus) after 180m/day");
    const uRow = db.prepare("SELECT xp FROM users WHERE user_id = 's1'").get() as { xp: number };
    assert.equal(uRow.xp, 60, "XP stays 1:1 with real study minutes");

    // 2. Whale P2P transfer fee (0% under 5,000, 3% at >= 5,000)
    registerPlayer(db, { userId: "s2", discordName: "مريم", gender: "female", acceptRules: true });
    depositAdmin(db, { userId: "s1", amount: 120000, description: "رصيد ثري" });
    const s1Before = getBankAccount(db, "s1")!.availableBalance;
    const txBig = transferBetweenUsers(db, {
      fromUserId: "s1",
      toUserId: "s2",
      amount: 10000,
    });
    assert.equal(txBig.transferFee, 300);
    assert.equal(getBankAccount(db, "s1")!.availableBalance, s1Before - 10300);

    // 3. Progressive Wealth Tax + Career Weekly Requirement on salary claim
    // s1 currently has 240m from step 1 (180 + 60); set to 100m first to verify block under 240m
    db.prepare("UPDATE study_daily_log SET regular_minutes = 100 WHERE user_id = 's1'").run();
    db.prepare("UPDATE users SET job = 'architect', xp = 10000 WHERE user_id = 's1'").run();
    const blockedSalary = claimSalaries(db, "s1");
    assert.equal(blockedSalary.totalGross, 0, "Salary blocked until 240m/week met");

    // Add 140m yesterday so total over last 7 days = 240m
    db.prepare(
      "INSERT INTO study_daily_log (user_id, day, regular_minutes, verified_minutes) VALUES ('s1', ?, 140, 100)"
    ).run(getIraqDateString(1));
    const taxedSalary = claimSalaries(db, "s1");
    // architect salary = 580, balance > 100,000 -> 15% wealth tax => 87 tax, 493 net
    assert.equal(taxedSalary.totalTax, 87);
    assert.equal(taxedSalary.totalGross, 493);

    // 4. Guild treasury donation & upgrade sink
    const guild = createGuild(db, { leaderId: "s1", name: "نخبة التوازن" })!;
    donateToGuild(db, { guildId: guild.id, userId: "s1", amount: 5000 });
    const upgraded = upgradeGuildLevel(db, guild.id, "s1")!;
    assert.equal(upgraded.guildLevel, 2);
    assert.equal(upgraded.treasuryCoins, 0);
  } finally {
    cleanup();
  }
});
