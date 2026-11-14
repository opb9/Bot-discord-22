import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_users_and_study_tables",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          user_id TEXT PRIMARY KEY,
          discord_name TEXT NOT NULL,
          gender TEXT CHECK(gender IN ('male', 'female')),
          job TEXT,
          bg TEXT,
          theme TEXT,
          quote TEXT,
          bio TEXT,
          xp INTEGER NOT NULL DEFAULT 0,
          minutes INTEGER NOT NULL DEFAULT 0,
          verified_minutes INTEGER NOT NULL DEFAULT 0,
          coins INTEGER NOT NULL DEFAULT 0,
          rules_accepted INTEGER NOT NULL DEFAULT 0,
          registered INTEGER NOT NULL DEFAULT 0,
          registered_at TEXT,
          is_admin INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS approved_study_rooms (
          room_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS study_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          room_id TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          last_tick_at INTEGER NOT NULL,
          regular_minutes INTEGER NOT NULL DEFAULT 0,
          verified_minutes INTEGER NOT NULL DEFAULT 0,
          screen_sharing INTEGER NOT NULL DEFAULT 0,
          screen_started_at INTEGER,
          status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'disconnected', 'recovered')),
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        );

        CREATE TABLE IF NOT EXISTS study_screen_segments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          minutes_credited INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (session_id) REFERENCES study_sessions(id)
        );

        CREATE TABLE IF NOT EXISTS study_daily_log (
          user_id TEXT NOT NULL,
          day TEXT NOT NULL,
          regular_minutes INTEGER NOT NULL DEFAULT 0,
          verified_minutes INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, day),
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    name: "bank_ledger_idempotency_and_loans",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS bank_accounts (
          user_id TEXT PRIMARY KEY,
          account_number TEXT NOT NULL UNIQUE,
          available_balance INTEGER NOT NULL DEFAULT 0 CHECK(available_balance >= 0),
          reserved_balance INTEGER NOT NULL DEFAULT 0 CHECK(reserved_balance >= 0),
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        );

        CREATE TABLE IF NOT EXISTS bank_ledger (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tx_id TEXT NOT NULL UNIQUE,
          user_id TEXT NOT NULL,
          tx_type TEXT NOT NULL,
          amount INTEGER NOT NULL,
          balance_after INTEGER NOT NULL,
          reserved_after INTEGER NOT NULL,
          related_user_id TEXT,
          reference_id TEXT,
          description TEXT NOT NULL,
          idempotency_key TEXT UNIQUE,
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        );

        CREATE TABLE IF NOT EXISTS idempotency_keys (
          key TEXT PRIMARY KEY,
          operation TEXT NOT NULL,
          response_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS loans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          principal INTEGER NOT NULL,
          fee INTEGER NOT NULL,
          total_due INTEGER NOT NULL,
          remaining_debt INTEGER NOT NULL CHECK(remaining_debt >= 0),
          status TEXT NOT NULL CHECK(status IN ('active', 'paid', 'legacy')),
          created_at TEXT NOT NULL,
          paid_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        );

        CREATE TABLE IF NOT EXISTS loan_repayments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          loan_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          source_type TEXT NOT NULL,
          gross_income INTEGER NOT NULL,
          repaid_amount INTEGER NOT NULL,
          net_income INTEGER NOT NULL,
          debt_after INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (loan_id) REFERENCES loans(id)
        );
      `);
    },
  },
  {
    version: 3,
    name: "shop_inventory_economy_ranks_challenges_guilds",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS shop_products (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK(kind IN ('job', 'character', 'bg', 'theme', 'quote')),
          name TEXT NOT NULL,
          title TEXT NOT NULL,
          emoji TEXT NOT NULL DEFAULT '⭐',
          male_label TEXT,
          female_label TEXT,
          color TEXT NOT NULL DEFAULT '#5865F2',
          price INTEGER NOT NULL DEFAULT 0,
          repeatable INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          image_path TEXT
        );

        CREATE TABLE IF NOT EXISTS user_inventory (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          product_id TEXT NOT NULL,
          variant TEXT NOT NULL DEFAULT 'default',
          purchased_at TEXT NOT NULL,
          UNIQUE(user_id, product_id, variant),
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        );

        CREATE TABLE IF NOT EXISTS purchase_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          product_id TEXT NOT NULL,
          variant TEXT NOT NULL,
          price_paid INTEGER NOT NULL,
          idempotency_key TEXT UNIQUE,
          purchased_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        );

        CREATE TABLE IF NOT EXISTS positions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          salary INTEGER NOT NULL,
          interval_days INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS position_members (
          user_id TEXT NOT NULL,
          position_id INTEGER NOT NULL,
          last_claim_ms INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, position_id)
        );

        CREATE TABLE IF NOT EXISTS salary_claims (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          claim_type TEXT NOT NULL,
          reference_key TEXT NOT NULL,
          period_key TEXT NOT NULL,
          amount INTEGER NOT NULL,
          claimed_at TEXT NOT NULL,
          UNIQUE(user_id, claim_type, reference_key, period_key)
        );

        CREATE TABLE IF NOT EXISTS ranks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          emoji TEXT NOT NULL DEFAULT '🎖️',
          description TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS user_ranks (
          user_id TEXT NOT NULL,
          rank_id INTEGER NOT NULL,
          awarded_at TEXT NOT NULL,
          PRIMARY KEY (user_id, rank_id)
        );

        CREATE TABLE IF NOT EXISTS challenges (
          id TEXT PRIMARY KEY,
          creator_id TEXT NOT NULL,
          title TEXT NOT NULL,
          mode TEXT NOT NULL CHECK(mode IN ('wager', 'free')),
          team_size INTEGER NOT NULL CHECK(team_size IN (1, 2, 4, 8)),
          bet_amount INTEGER NOT NULL DEFAULT 0,
          duration_hours INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending', 'active', 'frozen', 'completed', 'cancelled', 'expired')),
          invite_expires_at INTEGER NOT NULL,
          started_at INTEGER,
          ends_at INTEGER,
          winner_team TEXT CHECK(winner_team IN ('A', 'B', 'tie', NULL)),
          freeze_reason TEXT,
          cancel_reason TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS challenge_participants (
          challenge_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          team TEXT NOT NULL CHECK(team IN ('A', 'B')),
          invite_status TEXT NOT NULL CHECK(invite_status IN ('accepted', 'pending', 'declined', 'withdrawn')),
          bet_reserved INTEGER NOT NULL DEFAULT 0,
          verified_minutes INTEGER NOT NULL DEFAULT 0,
          payout_amount INTEGER NOT NULL DEFAULT 0,
          joined_at TEXT NOT NULL,
          PRIMARY KEY (challenge_id, user_id),
          FOREIGN KEY (challenge_id) REFERENCES challenges(id)
        );

        CREATE TABLE IF NOT EXISTS guilds (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          emblem TEXT NOT NULL DEFAULT '⚔️',
          description TEXT NOT NULL DEFAULT '',
          leader_id TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS guild_members (
          guild_id INTEGER NOT NULL,
          user_id TEXT PRIMARY KEY,
          role TEXT NOT NULL CHECK(role IN ('leader', 'officer', 'member')),
          joined_at TEXT NOT NULL,
          FOREIGN KEY (guild_id) REFERENCES guilds(id)
        );

        CREATE TABLE IF NOT EXISTS guild_invites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          invited_by TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'rejected')),
          created_at TEXT NOT NULL,
          UNIQUE(guild_id, user_id, status)
        );

        CREATE TABLE IF NOT EXISTS guild_activity_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id INTEGER NOT NULL,
          actor_id TEXT NOT NULL,
          action TEXT NOT NULL,
          details TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS custom_bg_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          idea TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_id TEXT NOT NULL,
          action TEXT NOT NULL,
          target_id TEXT,
          details TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 4,
    name: "user_salary_tracking_and_challenge_study_ticks",
    up: (db) => {
      db.exec(`
        ALTER TABLE users ADD COLUMN last_job_salary_at INTEGER NOT NULL DEFAULT 0;

        CREATE TABLE IF NOT EXISTS challenge_minute_logs (
          challenge_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          minute_bucket INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (user_id, minute_bucket)
        );
      `);
    },
  },
  {
    version: 5,
    name: "student_engagement_quests_shields_subjects_pomodoro",
    up: (db) => {
      db.exec(`
        ALTER TABLE users ADD COLUMN streak_shields INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE users ADD COLUMN pomodoro_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE users ADD COLUMN active_subject_id INTEGER;

        ALTER TABLE study_sessions ADD COLUMN subject_id INTEGER;
        ALTER TABLE study_sessions ADD COLUMN pomodoro_target INTEGER NOT NULL DEFAULT 0;

        CREATE TABLE IF NOT EXISTS daily_quest_claims (
          user_id TEXT NOT NULL,
          day TEXT NOT NULL,
          quest_id TEXT NOT NULL,
          reward_coins INTEGER NOT NULL,
          reward_xp INTEGER NOT NULL,
          claimed_at TEXT NOT NULL,
          PRIMARY KEY (user_id, day, quest_id),
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        );

        CREATE TABLE IF NOT EXISTS daily_chest_claims (
          user_id TEXT NOT NULL,
          day TEXT NOT NULL,
          reward_coins INTEGER NOT NULL,
          reward_xp INTEGER NOT NULL,
          reward_shield INTEGER NOT NULL DEFAULT 0,
          claimed_at TEXT NOT NULL,
          PRIMARY KEY (user_id, day),
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        );

        CREATE TABLE IF NOT EXISTS streak_shield_uses (
          user_id TEXT NOT NULL,
          saved_day TEXT NOT NULL,
          used_at TEXT NOT NULL,
          PRIMARY KEY (user_id, saved_day),
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        );

        CREATE TABLE IF NOT EXISTS study_subjects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          color TEXT NOT NULL DEFAULT '#5865F2',
          exam_date TEXT,
          target_weekly_minutes INTEGER NOT NULL DEFAULT 300,
          logged_minutes INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        );
      `);
    },
  },
  {
    version: 6,
    name: "career_tiers_and_guild_treasury_sinks",
    up: (db) => {
      db.exec(`
        ALTER TABLE shop_products ADD COLUMN min_level INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE shop_products ADD COLUMN salary INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE shop_products ADD COLUMN required_week_minutes INTEGER NOT NULL DEFAULT 120;

        ALTER TABLE guilds ADD COLUMN guild_level INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE guilds ADD COLUMN treasury_coins INTEGER NOT NULL DEFAULT 0;
      `);
    },
  },
];

export function openDatabase(dbPath: string): DatabaseSync {
  const dir = path.dirname(dbPath);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  return db;
}

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set<number>(
    (db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map(
      (r) => r.version
    )
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    withTransaction(db, () => {
      m.up(db);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        m.version,
        m.name,
        new Date().toISOString()
      );
    });
  }
}

export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = fn();
    db.exec("COMMIT;");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // ignore rollback errors if already rolled back
    }
    throw err;
  }
}
