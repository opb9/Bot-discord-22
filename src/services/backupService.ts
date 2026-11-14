import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { SYSTEM_CONFIG, getIraqTimestampString } from "../config/settings";
import { AppError } from "../security/auth";

export interface BackupMetadata {
  filename: string;
  path: string;
  sizeBytes: number;
  integrityOk: boolean;
  createdAt: string;
}

export function createVerifiedBackup(
  db: DatabaseSync,
  backupDir = "backups",
  retention = SYSTEM_CONFIG.BACKUP_RETENTION_COUNT
): BackupMetadata {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const stamp = getIraqTimestampString();
  const filename = `study_bot_${stamp}.db`;
  const targetPath = path.join(backupDir, filename);

  // SQLite VACUUM INTO creates an atomic, consistent snapshot safe during WAL reads/writes
  const escaped = targetPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}';`);

  const checkDb = new DatabaseSync(targetPath);
  let integrityOk = false;
  try {
    const res = checkDb.prepare("PRAGMA integrity_check;").get() as
      | { integrity_check: string }
      | undefined;
    integrityOk = res?.integrity_check === "ok";
  } finally {
    checkDb.close();
  }

  if (!integrityOk) {
    fs.unlinkSync(targetPath);
    throw new AppError("فشل التحقق من سلامة النسخة الاحتياطية.", 500);
  }

  // Prune old backups beyond retention policy
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith("study_bot_") && f.endsWith(".db"))
    .sort();
  if (files.length > retention) {
    const toDelete = files.slice(0, files.length - retention);
    for (const old of toDelete) {
      fs.unlinkSync(path.join(backupDir, old));
    }
  }

  const stat = fs.statSync(targetPath);
  return {
    filename,
    path: targetPath,
    sizeBytes: stat.size,
    integrityOk,
    createdAt: new Date().toISOString(),
  };
}

export function listBackups(backupDir = "backups"): BackupMetadata[] {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith("study_bot_") && f.endsWith(".db"))
    .sort()
    .reverse()
    .map((f) => {
      const p = path.join(backupDir, f);
      const stat = fs.statSync(p);
      return {
        filename: f,
        path: p,
        sizeBytes: stat.size,
        integrityOk: true,
        createdAt: stat.mtime.toISOString(),
      };
    });
}

export function verifyBackupFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const db = new DatabaseSync(filePath);
  try {
    const res = db.prepare("PRAGMA integrity_check;").get() as
      | { integrity_check: string }
      | undefined;
    return res?.integrity_check === "ok";
  } finally {
    db.close();
  }
}
