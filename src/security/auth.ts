import { DatabaseSync } from "node:sqlite";

export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function requireRegisteredUser(db: DatabaseSync, userId: string) {
  const cleanId = sanitizeId(userId);
  const row = db
    .prepare("SELECT * FROM users WHERE user_id = ?")
    .get(cleanId) as Record<string, unknown> | undefined;
  if (!row || Number(row.registered) !== 1) {
    throw new AppError("يجب إكمال التسجيل أولاً (إنشاء حساب وبنك واختيار الجنس والموافقة على القوانين).", 403);
  }
  return row;
}

export function requireAdmin(db: DatabaseSync, actorId: string): void {
  const cleanId = sanitizeId(actorId);
  const row = db
    .prepare("SELECT is_admin FROM users WHERE user_id = ?")
    .get(cleanId) as { is_admin: number } | undefined;
  if (!row || Number(row.is_admin) !== 1) {
    throw new AppError("هذا الأمر متاح للإدارة فقط (صلاحيات غير كافية).", 403);
  }
}

export function sanitizeId(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) {
    throw new AppError("معرف المستخدم غير صالح.", 400);
  }
  return s;
}

export function makeIdempotencyKey(prefix: string, provided?: string | null): string {
  if (provided && String(provided).trim().length >= 8) {
    return `${prefix}:${String(provided).trim().slice(0, 120)}`;
  }
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

export function logAudit(
  db: DatabaseSync,
  actorId: string,
  action: string,
  details: string,
  targetId?: string
): void {
  db.prepare(
    "INSERT INTO audit_logs (actor_id, action, target_id, details, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(actorId, action, targetId ?? null, details, new Date().toISOString());
}
