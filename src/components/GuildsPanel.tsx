import React, { useEffect, useState } from "react";
import { Crown, LogOut, Shield, Trophy, UserPlus, Users } from "lucide-react";
import { SYSTEM_CONFIG } from "../config/settings";
import { AppState } from "../types";

interface GuildsPanelProps {
  state: AppState;
  onAction: (url: string, body: unknown) => Promise<boolean>;
}

interface GuildDetails {
  id: number;
  name: string;
  emblem: string;
  description: string;
  guildLevel: number;
  treasuryCoins: number;
  nextUpgradeCost: number;
  totalMinutes: number;
  totalVerifiedMinutes: number;
  members: Array<{
    userId: string;
    discordName: string;
    role: string;
    minutes: number;
    verifiedMinutes: number;
    level: number;
  }>;
  logs: Array<{ id: number; action: string; details: string; created_at: string }>;
}

export const GuildsPanel: React.FC<GuildsPanelProps> = ({ state, onAction }) => {
  const [name, setName] = useState("");
  const [emblem, setEmblem] = useState("⚔️");
  const [description, setDescription] = useState("");
  const [inviteTarget, setInviteTarget] = useState("");
  const [donateAmount, setDonateAmount] = useState("500");
  const [myGuildDetails, setMyGuildDetails] = useState<GuildDetails | null>(null);

  useEffect(() => {
    if (!state.user.guild) {
      setMyGuildDetails(null);
      return;
    }
    fetch(`/api/guilds/${state.user.guild.id}`)
      .then((r) => r.json())
      .then(setMyGuildDetails)
      .catch(() => {});
  }, [state.user.guild, state.guilds]);

  const canCreateGuild = state.user.level >= SYSTEM_CONFIG.GUILD_CREATE_MIN_LEVEL;
  const peers = state.allUsers.filter((u) => u.id !== state.user.id && u.registered);

  return (
    <div className="space-y-6">
      {/* Pending Invites */}
      {state.user.guildInvites.length > 0 && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-950/20 p-5">
          <h3 className="mb-3 font-extrabold text-amber-300">📩 دعوات النقابات الواردة</h3>
          <div className="space-y-2">
            {state.user.guildInvites.map((inv) => (
              <div
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#101426] px-4 py-3 text-sm"
              >
                <span>
                  {inv.emblem} <strong>{inv.guild_name}</strong>
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => onAction(`/api/guilds/invites/${inv.id}/respond`, { accept: true })}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white"
                  >
                    قبول
                  </button>
                  <button
                    onClick={() => onAction(`/api/guilds/invites/${inv.id}/respond`, { accept: false })}
                    className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white"
                  >
                    رفض
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: My Guild or Create Guild */}
        <div className="space-y-6 lg:col-span-5">
          {state.user.guild && myGuildDetails ? (
            <div className="space-y-4 rounded-2xl border border-[#35446D] bg-[#191F38] p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-extrabold text-white">
                    {myGuildDetails.emblem} {myGuildDetails.name}
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">{myGuildDetails.description}</p>
                </div>
                <button
                  onClick={() => onAction("/api/guilds/leave", {})}
                  className="flex items-center gap-1 rounded-xl bg-rose-600/80 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-600"
                >
                  <LogOut className="h-3.5 w-3.5" /> مغادرة
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl bg-[#101426] p-3">
                  <div className="text-slate-400">مجموع الدراسة</div>
                  <div className="mt-1 text-base font-bold text-white">
                    {myGuildDetails.totalMinutes} د
                  </div>
                </div>
                <div className="rounded-xl bg-[#101426] p-3">
                  <div className="text-slate-400">الدقائق الموثقة</div>
                  <div className="mt-1 text-base font-bold text-cyan-300">
                    {myGuildDetails.totalVerifiedMinutes} د
                  </div>
                </div>
                <div className="rounded-xl bg-[#101426] p-3">
                  <div className="text-slate-400">مستوى النقابة</div>
                  <div className="mt-1 text-base font-bold text-[#8DE0B2]">
                    Lv.{myGuildDetails.guildLevel} / 10
                  </div>
                </div>
                <div className="rounded-xl bg-[#101426] p-3">
                  <div className="text-slate-400">خزينة النقابة</div>
                  <div className="mt-1 text-base font-bold text-[#FFD166]">
                    {myGuildDetails.treasuryCoins.toLocaleString()} 🪙
                  </div>
                </div>
              </div>

              {/* Guild Treasury Donation & Upgrade Sink */}
              <div className="space-y-2 rounded-xl border border-[#35446D]/60 bg-[#101426]/60 p-3 text-xs">
                <div className="font-bold text-slate-200">🏦 خزينة النقابة والترقية (توازن اقتصادي)</div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={100}
                    step={100}
                    value={donateAmount}
                    onChange={(e) => setDonateAmount(e.target.value)}
                    className="w-28 rounded-lg border border-[#35446D] bg-[#101426] px-2.5 py-1.5 text-white"
                  />
                  <button
                    onClick={() =>
                      onAction(`/api/guilds/${myGuildDetails.id}/donate`, {
                        amount: Number(donateAmount),
                      })
                    }
                    className="flex-1 rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-500"
                  >
                    تبرع للخزينة 🪙
                  </button>
                </div>
                {state.user.guild.role === "leader" && myGuildDetails.guildLevel < 10 && (
                  <button
                    disabled={myGuildDetails.treasuryCoins < myGuildDetails.nextUpgradeCost}
                    onClick={() => onAction(`/api/guilds/${myGuildDetails.id}/upgrade`, {})}
                    className="w-full rounded-lg bg-[#5865F2] py-2 font-bold text-white hover:bg-[#4752C4] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ⬆️ ترقية إلى Lv.{myGuildDetails.guildLevel + 1} (التكلفة:{" "}
                    {myGuildDetails.nextUpgradeCost.toLocaleString()} 🪙 من الخزينة)
                  </button>
                )}
              </div>

              {(state.user.guild.role === "leader" || state.user.guild.role === "officer") && (
                <div className="flex gap-2">
                  <select
                    value={inviteTarget}
                    onChange={(e) => setInviteTarget(e.target.value)}
                    className="flex-1 rounded-xl border border-[#35446D] bg-[#101426] px-3 py-2 text-xs text-white"
                  >
                    <option value="">اختر عضواً لدعوته...</option>
                    {peers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!inviteTarget}
                    onClick={() =>
                      onAction(`/api/guilds/${myGuildDetails.id}/invite`, {
                        targetUserId: inviteTarget,
                      })
                    }
                    className="flex items-center gap-1 rounded-xl bg-[#5865F2] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    <UserPlus className="h-3.5 w-3.5" /> دعوة
                  </button>
                </div>
              )}

              <div>
                <h4 className="mb-2 text-xs font-bold text-slate-300">الأعضاء</h4>
                <div className="space-y-1.5 text-xs">
                  {myGuildDetails.members.map((m) => (
                    <div
                      key={m.userId}
                      className="flex items-center justify-between rounded-xl bg-[#101426]/70 px-3 py-2"
                    >
                      <span className="flex items-center gap-1.5 font-bold text-white">
                        {m.role === "leader" && <Crown className="h-3.5 w-3.5 text-[#FFD166]" />}
                        {m.discordName}
                      </span>
                      <span className="text-slate-400">
                        Lv.{m.level} • {m.minutes} د
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-[#35446D] bg-[#191F38] p-6">
              <div className="mb-2 flex items-center gap-2 text-lg font-extrabold text-white">
                <Shield className="h-5 w-5 text-[#79A9FF]" />
                إنشاء نقابة جديدة
              </div>
              <p className="mb-4 text-xs leading-relaxed text-slate-400">
                يمكنك الانضمام لأي نقابة قبل المستوى 25، أما إنشاء نقابة جديدة فيتطلب المستوى{" "}
                <strong className="text-[#FFD166]">{SYSTEM_CONFIG.GUILD_CREATE_MIN_LEVEL}</strong>{" "}
                أو أعلى (مستواك الحالي: {state.user.level}).
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await onAction("/api/guilds", { name, emblem, description });
                  if (ok) {
                    setName("");
                    setDescription("");
                  }
                }}
                className="space-y-3 text-sm"
              >
                <div className="flex gap-2">
                  <input
                    value={emblem}
                    onChange={(e) => setEmblem(e.target.value)}
                    className="w-16 rounded-xl border border-[#35446D] bg-[#101426] px-2 py-2 text-center text-white"
                  />
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="اسم النقابة"
                    className="flex-1 rounded-xl border border-[#35446D] bg-[#101426] px-3 py-2 text-white"
                  />
                </div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="وصف قصير للنقابة..."
                  className="w-full rounded-xl border border-[#35446D] bg-[#101426] p-3 text-white"
                />
                <button
                  type="submit"
                  disabled={!canCreateGuild}
                  className="w-full rounded-xl bg-[#5865F2] py-2.5 font-bold text-white hover:bg-[#4752C4] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {canCreateGuild
                    ? "⚔️ إنشاء النقابة"
                    : `يتطلب المستوى ${SYSTEM_CONFIG.GUILD_CREATE_MIN_LEVEL} (مستواك ${state.user.level})`}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Right: Guild Leaderboard */}
        <div className="rounded-2xl border border-[#35446D] bg-[#191F38] p-6 lg:col-span-7">
          <div className="mb-4 flex items-center gap-2 text-lg font-extrabold text-white">
            <Trophy className="h-5 w-5 text-[#FFD166]" />
            ترتيب النقابات
          </div>
          <div className="space-y-3">
            {state.guilds.map((g, idx) => (
              <div
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#35446D]/60 bg-[#101426]/80 p-4"
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg font-extrabold text-[#FFD166]">#{idx + 1}</span>
                  <div>
                    <div className="flex items-center gap-2 font-bold text-white">
                      <span>
                        {g.emblem} {g.name}
                      </span>
                      <span className="rounded-md bg-[#5865F2]/20 px-2 py-0.5 text-[11px] font-bold text-[#79A9FF]">
                        Lv.{g.guild_level || 1}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400">
                      <Users className="ml-1 inline h-3.5 w-3.5" />
                      {g.member_count} أعضاء • {g.total_minutes} د إجمالي ({g.total_verified_minutes} د موثقة) • خزينة: {(g.treasury_coins || 0).toLocaleString()} 🪙
                    </div>
                  </div>
                </div>
                {!state.user.guild && (
                  <button
                    onClick={() => onAction(`/api/guilds/${g.id}/join`, {})}
                    className="rounded-xl bg-[#5865F2] px-4 py-2 text-xs font-bold text-white hover:bg-[#4752C4]"
                  >
                    انضمام
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
