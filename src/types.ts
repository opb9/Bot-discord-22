import { GenderKey } from "./data/botData";

export interface RankItem {
  id: number;
  name: string;
  emoji: string;
  description?: string;
}

export interface PositionItem {
  id: number;
  name: string;
  salary: number;
  intervalDays: number;
  lastClaim?: number;
  members?: Array<{ id: string; name: string }>;
}

export interface LoanItem {
  id: number;
  userId: string;
  principal: number;
  fee: number;
  totalDue: number;
  remainingDebt: number;
  status: "active" | "paid" | "legacy";
  createdAt: string;
  paidAt: string | null;
}

export interface LedgerEntry {
  id: number;
  txId: string;
  txType: string;
  amount: number;
  balanceAfter: number;
  reservedAfter: number;
  relatedUserId: string | null;
  referenceId: string | null;
  description: string;
  createdAt: string;
}

export interface ProductItem {
  id: string;
  kind: "job" | "character" | "bg" | "theme" | "quote";
  name: string;
  title: string;
  emoji: string;
  male_label: string | null;
  female_label: string | null;
  color: string;
  price: number;
  repeatable: number;
  image_path: string | null;
  min_level: number;
  salary: number;
  required_week_minutes: number;
}

export interface StudyRoom {
  roomId: string;
  name: string;
  description: string;
  isActive: boolean;
}

export interface ActiveStudySession {
  id: string;
  userId: string;
  roomId: string;
  roomName: string;
  startedAt: number;
  lastTickAt: number;
  regularMinutes: number;
  verifiedMinutes: number;
  screenSharing: boolean;
  screenStartedAt: number | null;
  status: string;
}

export interface ChallengeParticipant {
  userId: string;
  discordName: string;
  team: "A" | "B";
  inviteStatus: "accepted" | "pending" | "declined" | "withdrawn";
  verifiedMinutes: number | null;
  payoutAmount: number | null;
}

export interface ChallengeItem {
  id: string;
  creatorId: string;
  title: string;
  mode: "wager" | "free";
  teamSize: 1 | 2 | 4 | 8;
  betAmount: number;
  durationHours: number;
  status: "pending" | "active" | "frozen" | "completed" | "cancelled" | "expired";
  inviteExpiresAt: number;
  startedAt: number | null;
  endsAt: number | null;
  winnerTeam: "A" | "B" | "tie" | null;
  freezeReason: string | null;
  cancelReason: string | null;
  isSecretPhase: boolean;
  teamATotal: number | null;
  teamBTotal: number | null;
  participants: ChallengeParticipant[];
}

export interface GuildSummary {
  id: number;
  name: string;
  emblem: string;
  description: string;
  leader_id: string;
  guild_level: number;
  treasury_coins: number;
  member_count: number;
  total_minutes: number;
  total_verified_minutes: number;
}

export interface UserProfile {
  id: string;
  name: string;
  registered: boolean;
  rulesAccepted: boolean;
  isAdmin: boolean;
  coins: number;
  reservedBalance: number;
  accountNumber: string | null;
  minutes: number;
  verifiedMinutes: number;
  xp: number;
  level: number;
  xpCur: number;
  xpNeed: number;
  gender: GenderKey | null;
  job: string | null;
  avatarUrl: string | null;
  bg: string | null;
  theme: string | null;
  quote: string | null;
  bio: string | null;
  debt: number;
  activeLoan: LoanItem | null;
  loanHistory: LoanItem[];
  streak: number;
  todayMinutes: number;
  todayVerifiedMinutes: number;
  weekMinutesLast7: number;
  ranks: RankItem[];
  positions: PositionItem[];
  guild: { id: number; name: string; emblem: string; role: string } | null;
  guildInvites: Array<{
    id: number;
    guild_id: number;
    guild_name: string;
    emblem: string;
    invited_by: string;
  }>;
  challengeRecord: {
    played: number;
    wins: number;
    losses: number;
    ties: number;
    totalVerifiedMinutes: number;
    totalCoinsEarned: number;
    bestMinutes: number;
  };
  inventory: Array<{
    product_id: string;
    variant: string;
    purchased_at: string;
    kind: string;
    name: string;
    emoji: string;
  }>;
  purchaseHistory: Array<{
    id: number;
    product_id: string;
    variant: string;
    price_paid: number;
    purchased_at: string;
    name: string;
    emoji: string;
  }>;
  ledger: LedgerEntry[];
  engagement: EngagementSummary;
}

export interface StudyPerkItem {
  id: string;
  title: string;
  description: string;
  requiredMinutes: number;
  badge: string;
  unlocked: boolean;
  shopDiscountPct: number;
  xpBoostPct: number;
}

export interface DailyQuestItem {
  id: string;
  title: string;
  description: string;
  metric: "regular_today" | "verified_today";
  targetMinutes: number;
  progressMinutes: number;
  baseCoins: number;
  baseXp: number;
  finalCoins: number;
  finalXp: number;
  completed: boolean;
  claimed: boolean;
}

export interface StudySubjectItem {
  id: number;
  name: string;
  color: string;
  examDate: string | null;
  targetWeeklyMinutes: number;
  loggedMinutes: number;
}

export interface EngagementSummary {
  today: string;
  streak: number;
  streakMultiplier: number;
  streakShields: number;
  maxStreakShields: number;
  shieldPrice: number;
  pomodoroCount: number;
  activeSubjectId: number | null;
  shopDiscountPct: number;
  xpBoostPct: number;
  perks: StudyPerkItem[];
  quests: DailyQuestItem[];
  dailyChest: {
    requiredMinutes: number;
    todayMinutes: number;
    unlocked: boolean;
    claimed: boolean;
    lastReward: { coins: number; xp: number; shield: number } | null;
  };
  subjects: StudySubjectItem[];
}

export interface BackupInfo {
  filename: string;
  sizeBytes: number;
  integrityOk: boolean;
  createdAt: string;
}

export interface AppState {
  user: UserProfile;
  allUsers: Array<{
    id: string;
    name: string;
    registered: boolean;
    isAdmin: boolean;
    coins: number;
    minutes: number;
    verifiedMinutes: number;
    level: number;
    job: string | null;
    gender: GenderKey | null;
    avatarUrl: string | null;
  }>;
  products: ProductItem[];
  rooms: StudyRoom[];
  activeStudySession: ActiveStudySession | null;
  challenges: ChallengeItem[];
  guilds: GuildSummary[];
  positions: PositionItem[];
  ranks: RankItem[];
  bgRequests: Array<{
    id: number;
    userId: string;
    userName: string;
    idea: string;
    status: string;
    createdAt: string;
  }>;
  backups: BackupInfo[];
  auditLogs: Array<{
    id: number;
    actor_id: string;
    action: string;
    target_id: string | null;
    details: string;
    created_at: string;
  }>;
}

export interface StatsPayload {
  day: number;
  dayVerified: number;
  week: number;
  weekVerified: number;
  month: number;
  year: number;
  all: number;
  allVerified: number;
  streak: number;
  last7Days: Array<{ date: string; label: string; minutes: number; verifiedMinutes: number }>;
  months: Array<{ month: string; minutes: number; verifiedMinutes: number }>;
  yearNumber: number;
}

export interface LeaderboardRow {
  id: string;
  name: string;
  minutes: number;
  verifiedMinutes: number;
  level: number;
  job: string | null;
  gender: GenderKey | null;
}
