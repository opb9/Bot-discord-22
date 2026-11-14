export const SYSTEM_CONFIG = {
  TIMEZONE_OFFSET_HOURS: 3, // توقيت العراق UTC+3
  COIN_PER_MINUTE: 1,
  HOUR_BONUS: 5,
  VERIFIED_BONUS_MULTIPLIER: 1, // الدقائق الموثقة جزء من العادية ولا تُحتسب مرتين
  STUDENT_AFTER_MIN: 10,
  MAX_LEVEL: 100,
  XP_BASE: 30,
  XP_GROWTH: 1.04,
  REGISTRATION_BONUS: 250,

  // القروض (النظام المعتمد)
  LOAN_MIN: 3000,
  LOAN_MAX: 10000,
  LOAN_FEE_RATE: 0.5, // رسوم 50%
  LOAN_AUTO_REPAY_SHARE: 0.5, // 50% من الدخل

  // التحديات الدراسية
  CHALLENGE_MIN_HOURS: 2,
  CHALLENGE_MAX_DAYS: 7,
  CHALLENGE_INVITE_EXPIRY_HOURS: 24,
  CHALLENGE_ALLOWED_SIZES: [1, 2, 4, 8] as const,
  CHALLENGE_ALLOWED_BETS: [100, 500, 1000, 10000, 25000, 50000, 100000] as const,
  FREE_CHALLENGE_BASE_REWARD_PER_HOUR: 20,
  FREE_CHALLENGE_MAX_REWARD_CAP: 500, // سقف يمنع استغلال التحديات المجانية
  FREE_CHALLENGE_REWARDS_ENABLED: true,

  // النقابات
  GUILD_CREATE_MIN_LEVEL: 25,
  GUILD_MAX_MEMBERS: 30,

  // الرواتب
  SALARY_INTERVAL_DAYS: 7,
  SALARY_MIN_WEEK_MINUTES: 120,
  DEFAULT_JOB_SALARY: 150,

  // النسخ الاحتياطي
  BACKUP_RETENTION_COUNT: 14,
};

export function getIraqNow(): Date {
  return new Date(Date.now() + SYSTEM_CONFIG.TIMEZONE_OFFSET_HOURS * 3600 * 1000);
}

export function getIraqDateString(offsetDays = 0): string {
  const ms =
    Date.now() +
    SYSTEM_CONFIG.TIMEZONE_OFFSET_HOURS * 3600 * 1000 -
    offsetDays * 86400 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function getIraqTimestampString(): string {
  return getIraqNow().toISOString().replace("T", "_").replace(/[:.]/g, "-").slice(0, 19);
}
