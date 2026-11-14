import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "../src/database/db";
import { registerPlayer } from "../src/services/registrationService";
import {
  addStudyRoom,
  getActiveStudySession,
  joinStudyRoom,
  leaveStudyRoom,
  recoverInterruptedSessions,
  setScreenShareState,
} from "../src/services/studyService";
import { seedDefaultProducts } from "../src/services/shopService";

function createTestDb(name: string) {
  const dbPath = path.join("backups", `test_${name}_${Date.now()}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = openDatabase(dbPath);
  seedDefaultProducts(db);
  addStudyRoom(db, "r1", "غرفة 1");
  addStudyRoom(db, "r2", "غرفة 2");
  registerPlayer(db, { userId: "u1", discordName: "أحمد", gender: "male", acceptRules: true });
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

test("Study: regular vs verified screen-share, no double count, camera alone does not count", () => {
  const { db, cleanup } = createTestDb("study_1");
  try {
    const t0 = 1_700_000_000_000;
    // Join with cameraOn=true, screenSharing=false -> should NOT record verified minutes
    joinStudyRoom(db, { userId: "u1", roomId: "r1", screenSharing: false, cameraOn: true, nowMs: t0 });
    // After 10 minutes, turn on screen share
    const s1 = setScreenShareState(db, "u1", true, t0 + 10 * 60_000);
    assert.equal(s1.regularMinutes, 10);
    assert.equal(s1.verifiedMinutes, 0);

    // After 15 more minutes (t0 + 25m), stop screen share
    const s2 = setScreenShareState(db, "u1", false, t0 + 25 * 60_000);
    assert.equal(s2.regularMinutes, 25);
    assert.equal(s2.verifiedMinutes, 15);

    // Stay 5 more minutes in regular study then leave (total 30 regular, 15 verified)
    const done = leaveStudyRoom(db, "u1", t0 + 30 * 60_000);
    assert.equal(done.regularMinutes, 30);
    assert.equal(done.verifiedMinutes, 15);
    // Verified is a subset of regular (total earned = 30 coins, not 45)
    assert.equal(done.earned, 30);
    assert.equal(done.unlockedStudent, true);
  } finally {
    cleanup();
  }
});

test("Study: switching rooms settles previous session cleanly without overlapping", () => {
  const { db, cleanup } = createTestDb("study_switch");
  try {
    const t0 = 1_700_000_000_000;
    joinStudyRoom(db, { userId: "u1", roomId: "r1", screenSharing: true, nowMs: t0 });
    const switched = joinStudyRoom(db, { userId: "u1", roomId: "r2", screenSharing: false, nowMs: t0 + 12 * 60_000 });
    assert.equal(switched.roomId, "r2");
    assert.equal(getActiveStudySession(db, "u1")?.roomId, "r2");

    const userRow = db.prepare("SELECT minutes, verified_minutes FROM users WHERE user_id = 'u1'").get() as {
      minutes: number;
      verified_minutes: number;
    };
    assert.equal(userRow.minutes, 12);
    assert.equal(userRow.verified_minutes, 12);

    const activeCount = (
      db.prepare("SELECT COUNT(*) as c FROM study_sessions WHERE user_id = 'u1' AND status = 'active'").get() as {
        c: number;
      }
    ).c;
    assert.equal(activeCount, 1);
  } finally {
    cleanup();
  }
});

test("Study: bot restart recovery caps minutes safely without inflating offline downtime", () => {
  const { db, cleanup } = createTestDb("study_recover");
  try {
    const t0 = 1_700_000_000_000;
    joinStudyRoom(db, { userId: "u1", roomId: "r1", screenSharing: true, nowMs: t0 });
    // Simulate a tick 8 minutes in, then bot crashed and restarted 5 hours later
    setScreenShareState(db, "u1", true, t0 + 8 * 60_000);
    const recovered = recoverInterruptedSessions(db, { capAtLastTick: true });
    assert.equal(recovered, 1);
    assert.equal(getActiveStudySession(db, "u1"), null);

    const userRow = db.prepare("SELECT minutes, verified_minutes FROM users WHERE user_id = 'u1'").get() as {
      minutes: number;
      verified_minutes: number;
    };
    assert.equal(userRow.minutes, 8);
    assert.equal(userRow.verified_minutes, 8);
  } finally {
    cleanup();
  }
});

test("Study: unapproved rooms and unregistered users are blocked", () => {
  const { db, cleanup } = createTestDb("study_guards");
  try {
    assert.throws(() => joinStudyRoom(db, { userId: "u1", roomId: "fake-room" }), /غير معتمدة/);
    assert.throws(() => joinStudyRoom(db, { userId: "unreg", roomId: "r1" }), /التسجيل/);
  } finally {
    cleanup();
  }
});
