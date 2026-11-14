import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "../src/database/db";
import { registerPlayer } from "../src/services/registrationService";
import { depositAdmin, getBankAccount } from "../src/services/bankService";
import { buyProduct, getPurchaseHistory, seedDefaultProducts } from "../src/services/shopService";
import { createGuild, joinGuildDirectly, leaveGuild } from "../src/services/guildService";
import { createVerifiedBackup, verifyBackupFile } from "../src/services/backupService";

function createTestDb(name: string) {
  const dbPath = path.join("backups", `test_${name}_${Date.now()}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = openDatabase(dbPath);
  seedDefaultProducts(db);
  registerPlayer(db, { userId: "u1", discordName: "قائد", gender: "male", acceptRules: true });
  registerPlayer(db, { userId: "u2", discordName: "عضو", gender: "female", acceptRules: true });
  return {
    db,
    dbPath,
    cleanup: () => {
      db.close();
      for (const suffix of ["", "-wal", "-shm"]) {
        if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
      }
    },
  };
}

test("Shop: One Piece characters pricing, atomic debit, duplicate non-repeatable guard, purchase history", () => {
  const { db, cleanup } = createTestDb("shop");
  try {
    // Insufficient funds for Luffy (50,000)
    assert.throws(() => buyProduct(db, { userId: "u1", productId: "luffy", variant: "male" }), /غير كافٍ/);
    assert.equal(getBankAccount(db, "u1")?.availableBalance, 250);

    depositAdmin(db, { userId: "u1", amount: 250000, description: "رصيد متجر" });
    const res1 = buyProduct(db, { userId: "u1", productId: "luffy", variant: "male" });
    assert.equal(res1.equippedOnly, false);
    assert.equal(getBankAccount(db, "u1")?.availableBalance, 200250);

    // Buying Luffy again equips without double charging
    const res2 = buyProduct(db, { userId: "u1", productId: "luffy", variant: "male" });
    assert.equal(res2.equippedOnly, true);
    assert.equal(getBankAccount(db, "u1")?.availableBalance, 200250);

    // Buy Joy Boy (100,000) & Charlotte Linlin (75,000)
    buyProduct(db, { userId: "u1", productId: "joyboy", variant: "male" });
    buyProduct(db, { userId: "u1", productId: "charlotte_linlin", variant: "female" });
    assert.equal(getBankAccount(db, "u1")?.availableBalance, 25250);

    const history = getPurchaseHistory(db, "u1");
    assert.equal(history.length, 3);
  } finally {
    cleanup();
  }
});

test("Guilds: blocked creation below Lv 25, allowed at Lv 25+, join before Lv 25, leave", () => {
  const { db, cleanup } = createTestDb("guilds");
  try {
    assert.throws(
      () => createGuild(db, { leaderId: "u1", name: "نقابة الأبطال" }),
      /المستوى 25/
    );

    // Grant u1 enough XP for Level 25+
    db.prepare("UPDATE users SET xp = 1400 WHERE user_id = 'u1'").run();
    const guild = createGuild(db, { leaderId: "u1", name: "نقابة الأبطال", emblem: "⚔️" })!;
    assert.equal(guild.name, "نقابة الأبطال");

    // u2 (< Lv 25) CAN join an existing guild
    const joined = joinGuildDirectly(db, guild.id, "u2")!;
    assert.equal(joined.members.length, 2);

    const left = leaveGuild(db, "u2");
    assert.equal(left.disbanded, false);
  } finally {
    cleanup();
  }
});

test("Backup: creates verified timestamped SQLite snapshot passing PRAGMA integrity_check", () => {
  const { db, cleanup } = createTestDb("backup");
  const tmpBackupDir = path.join("backups", `tmp_suite_${Date.now()}`);
  try {
    const meta = createVerifiedBackup(db, tmpBackupDir, 5);
    assert.equal(meta.integrityOk, true);
    assert.ok(meta.sizeBytes > 0);
    assert.equal(verifyBackupFile(meta.path), true);
  } finally {
    if (fs.existsSync(tmpBackupDir)) {
      fs.rmSync(tmpBackupDir, { recursive: true, force: true });
    }
    cleanup();
  }
});
