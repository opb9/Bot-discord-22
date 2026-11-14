import { DatabaseSync } from "node:sqlite";
import { getIraqDateString } from "../config/settings";
import { registerPlayer } from "../services/registrationService";
import { depositAdmin } from "../services/bankService";
import { seedDefaultProducts } from "../services/shopService";
import { addStudyRoom } from "../services/studyService";
import { ensureDefaultJobAvatars } from "./avatarGenerator";

const DEFAULT_POSITIONS: Array<[string, number, number]> = [
  ["مشرف قاعة الدراسة", 350, 7],
  ["مرشد الطلاب الجدد", 300, 7],
  ["أمين مكتبة الموارد", 280, 7],
  ["محرر النشرة العلمية", 320, 7],
  ["قائد جلسات بومودورو", 400, 7],
  ["مراقب توثيق الشاشة", 450, 7],
  ["مستشار المواد والامتحانات", 480, 7],
  ["منسق التحديات الكبرى", 500, 7],
  ["مراجع الاختبارات التجريبية", 550, 7],
  ["سفير النقابات النشطة", 600, 7],
  ["مُدرّب تقني للبرمجة", 650, 7],
  ["نائب إدارة المنصة", 950, 7],
];

export function seedInitialEcosystem(db: DatabaseSync): void {
  ensureDefaultJobAvatars();
  seedDefaultProducts(db);

  for (const [name, salary, days] of DEFAULT_POSITIONS) {
    db.prepare(
      "INSERT OR IGNORE INTO positions (name, salary, interval_days) VALUES (?, ?, ?)"
    ).run(name, salary, days);
  }

  // Seed approved study rooms if empty
  const roomCount = (
    db.prepare("SELECT COUNT(*) as c FROM approved_study_rooms").get() as { c: number }
  ).c;
  if (roomCount === 0) {
    addStudyRoom(db, "room-focus-1", "قاعة التركيز الصامت", "غرفة دراسة هادئة معتمدة");
    addStudyRoom(db, "room-cam-screen", "قاعة المذاكرة الموثقة", "مخصصة لمشاركة الشاشة والتحديات");
    addStudyRoom(db, "room-deep-work", "غرفة العمل العميق", "جلسات بومودورو ومراجعة");
  }

  // Only seed users if DB is completely fresh
  const userCount = (db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
  if (userCount > 0) return;

  const today = getIraqDateString(0);
  const y1 = getIraqDateString(1);
  const y2 = getIraqDateString(2);

  // Primary player (Admin & Registered)
  registerPlayer(db, {
    userId: "1",
    discordName: "طالب مجتهد",
    gender: "male",
    acceptRules: true,
    isAdmin: true,
  });
  depositAdmin(db, {
    userId: "1",
    amount: 4750,
    description: "رصيد تأسيسي تجريبي للحساب البنكي",
    idempotencyKey: "seed:1:init",
  });
  db.prepare(
    "UPDATE users SET job = 'student', minutes = 145, verified_minutes = 90, xp = 180, bio = 'أركز على بناء عادة دراسة يومية ثابتة.' WHERE user_id = '1'"
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO user_inventory (user_id, product_id, variant, purchased_at) VALUES ('1', 'student', 'male', ?)"
  ).run(new Date().toISOString());
  db.prepare(
    "INSERT OR IGNORE INTO study_daily_log (user_id, day, regular_minutes, verified_minutes) VALUES ('1', ?, 40, 25), ('1', ?, 55, 35), ('1', ?, 50, 30)"
  ).run(y2, y1, today);

  // Peer 2 (Level 25+ eligible for guild creation)
  registerPlayer(db, {
    userId: "2",
    discordName: "سارة أحمد",
    gender: "female",
    acceptRules: true,
  });
  depositAdmin(db, {
    userId: "2",
    amount: 12000,
    description: "رصيد تأسيسي",
    idempotencyKey: "seed:2:init",
  });
  db.prepare(
    "UPDATE users SET job = 'doctor', minutes = 640, verified_minutes = 480, xp = 1400 WHERE user_id = '2'"
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO study_daily_log (user_id, day, regular_minutes, verified_minutes) VALUES ('2', ?, 200, 160), ('2', ?, 240, 180), ('2', ?, 200, 140)"
  ).run(y2, y1, today);

  // Peer 3
  registerPlayer(db, {
    userId: "3",
    discordName: "عمر خالد",
    gender: "male",
    acceptRules: true,
  });
  depositAdmin(db, {
    userId: "3",
    amount: 8500,
    description: "رصيد تأسيسي",
    idempotencyKey: "seed:3:init",
  });
  db.prepare(
    "UPDATE users SET job = 'programmer', minutes = 510, verified_minutes = 390, xp = 750 WHERE user_id = '3'"
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO study_daily_log (user_id, day, regular_minutes, verified_minutes) VALUES ('3', ?, 180, 140), ('3', ?, 170, 130), ('3', ?, 160, 120)"
  ).run(y2, y1, today);

  // Peer 4 (Unregistered user to test mandatory registration gate if switched to)
  db.prepare(
    "INSERT OR IGNORE INTO users (user_id, discord_name, registered, rules_accepted, created_at) VALUES ('4', 'نور الهدى', 0, 0, ?)"
  ).run(new Date().toISOString());

  // Ranks & Positions
  db.prepare("INSERT OR IGNORE INTO ranks (id, name, emoji, description) VALUES (1, 'مثابر', '🔥', 'للملتزمين بالدراسة اليومية')").run();
  db.prepare("INSERT OR IGNORE INTO ranks (id, name, emoji, description) VALUES (2, 'نجم التحديات', '🏆', 'لأبطال التحديات الموثقة')").run();
  db.prepare("INSERT OR IGNORE INTO user_ranks (user_id, rank_id, awarded_at) VALUES ('1', 1, ?)").run(new Date().toISOString());

  db.prepare("INSERT OR IGNORE INTO positions (id, name, salary, interval_days) VALUES (1, 'مشرف قاعة الدراسة', 350, 7)").run();
  db.prepare("INSERT OR IGNORE INTO position_members (user_id, position_id, last_claim_ms) VALUES ('2', 1, 0)").run();

  // Sample Guild led by سارة أحمد (Level 25+)
  db.prepare(
    "INSERT OR IGNORE INTO guilds (id, name, emblem, description, leader_id, created_at) VALUES (1, 'نخبة المذاكرة', '⚔️', 'نقابة للتركيز العالي والتحديات الموثقة', '2', ?)"
  ).run(new Date().toISOString());
  db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, role, joined_at) VALUES (1, '2', 'leader', ?)").run(new Date().toISOString());
  db.prepare("INSERT OR IGNORE INTO guild_members (guild_id, user_id, role, joined_at) VALUES (1, '3', 'member', ?)").run(new Date().toISOString());
}
