import React, { useState } from "react";
import { EyeOff, Lock, ShieldAlert, Swords, Trophy, UserCheck, XCircle } from "lucide-react";
import { SYSTEM_CONFIG } from "../config/settings";
import { AppState } from "../types";

interface ChallengesPanelProps {
  state: AppState;
  onAction: (url: string, body: unknown) => Promise<boolean>;
}

export const ChallengesPanel: React.FC<ChallengesPanelProps> = ({ state, onAction }) => {
  const [title, setTitle] = useState("تحدي المذاكرة المركزة");
  const [mode, setMode] = useState<"wager" | "free">("wager");
  const [teamSize, setTeamSize] = useState<1 | 2 | 4 | 8>(1);
  const [betAmount, setBetAmount] = useState<number>(100);
  const [durationHours, setDurationHours] = useState<number>(2);
  const [opponentId, setOpponentId] = useState<string>(
    state.allUsers.find((u) => u.id !== state.user.id && u.registered)?.id || "2"
  );
  const [busy, setBusy] = useState(false);

  const peers = state.allUsers.filter((u) => u.id !== state.user.id && u.registered);
  const rec = state.user.challengeRecord;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const teamAIds = [state.user.id];
    const teamBIds = [opponentId];
    // For 2v2/4v4/8v8 demo UI, allow selecting or building team arrays
    await onAction("/api/challenges", {
      title,
      mode,
      teamSize,
      betAmount: mode === "wager" ? betAmount : 0,
      durationHours,
      teamAIds,
      teamBIds,
    });
    setBusy(false);
  };

  return (
    <div className="space-y-6">
      {/* Player Challenge Record */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "تحديات مكتملة", value: rec.played },
          { label: "مرات الفوز", value: rec.wins, color: "text-emerald-400" },
          { label: "الخسارة", value: rec.losses, color: "text-rose-400" },
          { label: "التعادل", value: rec.ties, color: "text-amber-300" },
          { label: "دقائق موثقة بالتحديات", value: rec.totalVerifiedMinutes, color: "text-cyan-300" },
          { label: "أرباح التحديات", value: `${rec.totalCoinsEarned.toLocaleString()} 🪙`, color: "text-[#FFD166]" },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-[#35446D] bg-[#191F38] p-3.5">
            <div className="text-xs text-slate-400">{item.label}</div>
            <div className={`mt-1 text-lg font-extrabold ${item.color || "text-white"}`}>
              {item.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Create Challenge Form */}
        <div className="rounded-2xl border border-[#35446D] bg-[#191F38] p-6 lg:col-span-5">
          <div className="mb-4 flex items-center gap-2 text-lg font-extrabold text-white">
            <Swords className="h-5 w-5 text-[#FFD166]" />
            إنشاء تحدٍ دراسي موثق
          </div>
          <form onSubmit={handleCreate} className="space-y-4 text-sm">
            <div>
              <label className="mb-1 block font-semibold text-slate-300">عنوان التحدي</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full rounded-xl border border-[#35446D] bg-[#101426] px-3.5 py-2.5 text-white outline-none focus:border-[#568BFF]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-semibold text-slate-300">نوع التحدي</label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "wager" | "free")}
                  className="w-full rounded-xl border border-[#35446D] bg-[#101426] px-3 py-2.5 text-white"
                >
                  <option value="wager">🪙 برهان من البنك</option>
                  <option value="free">🆓 مجاني (مكافأة محدودة)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-300">حجم الفرق</label>
                <select
                  value={teamSize}
                  onChange={(e) => setTeamSize(Number(e.target.value) as 1 | 2 | 4 | 8)}
                  className="w-full rounded-xl border border-[#35446D] bg-[#101426] px-3 py-2.5 text-white"
                >
                  {SYSTEM_CONFIG.CHALLENGE_ALLOWED_SIZES.map((sz) => (
                    <option key={sz} value={sz}>
                      {sz} ضد {sz}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {mode === "wager" && (
              <div>
                <label className="mb-1 block font-semibold text-slate-300">
                  مبلغ الرهان لكل لاعب (بدون عمولة)
                </label>
                <select
                  value={betAmount}
                  onChange={(e) => setBetAmount(Number(e.target.value))}
                  className="w-full rounded-xl border border-[#35446D] bg-[#101426] px-3 py-2.5 text-white"
                >
                  {SYSTEM_CONFIG.CHALLENGE_ALLOWED_BETS.map((b) => (
                    <option key={b} value={b}>
                      {b.toLocaleString()} 🪙
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-semibold text-slate-300">
                  المدة بالساعات (2 إلى 168)
                </label>
                <input
                  type="number"
                  min={2}
                  max={168}
                  value={durationHours}
                  onChange={(e) => setDurationHours(Number(e.target.value))}
                  className="w-full rounded-xl border border-[#35446D] bg-[#101426] px-3 py-2.5 text-white"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-300">الخصم المدعو</label>
                <select
                  value={opponentId}
                  onChange={(e) => setOpponentId(e.target.value)}
                  className="w-full rounded-xl border border-[#35446D] bg-[#101426] px-3 py-2.5 text-white"
                >
                  {peers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.coins.toLocaleString()} 🪙)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-xl bg-[#101426]/80 p-3 text-xs leading-relaxed text-slate-400">
              • لا تُحجز الرهانات حتى يوافق جميع المشاركين.
              <br />
              • الفوز يُحسب بمجموع دقائق الدراسة <strong>الموثقة بمشاركة الشاشة</strong> فقط.
              <br />• أثناء التحدي، ترى دقائقك الموثقة فقط بسرية تامة.
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-[#5865F2] py-3 font-bold text-white hover:bg-[#4752C4]"
            >
              ⚔️ إرسال دعوة التحدي
            </button>
          </form>
        </div>

        {/* Active & Past Challenges */}
        <div className="space-y-4 lg:col-span-7">
          <h3 className="flex items-center gap-2 text-lg font-extrabold text-white">
            <Trophy className="h-5 w-5 text-[#FFD166]" />
            التحديات الحالية والسابقة
          </h3>

          {state.challenges.length === 0 ? (
            <div className="rounded-2xl border border-[#35446D] bg-[#191F38] p-8 text-center text-sm text-slate-400">
              لا توجد تحديات بعد — أنشئ تحدياً جديداً الآن!
            </div>
          ) : (
            state.challenges.map((ch) => {
              const myParticipant = ch.participants.find((p) => p.userId === state.user.id);
              const teamA = ch.participants.filter((p) => p.team === "A");
              const teamB = ch.participants.filter((p) => p.team === "B");

              return (
                <div
                  key={ch.id}
                  className="space-y-4 rounded-2xl border border-[#35446D] bg-[#191F38] p-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#35446D]/60 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-white">{ch.title}</span>
                        <span className="rounded-md bg-[#101426] px-2 py-0.5 font-mono text-xs text-slate-400">
                          {ch.id}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {ch.teamSize} ضد {ch.teamSize} • {ch.durationHours} ساعة •{" "}
                        {ch.mode === "wager"
                          ? `رهان ${ch.betAmount.toLocaleString()} 🪙`
                          : "تحدي مجاني"}
                      </div>
                    </div>

                    <span
                      className={`rounded-lg px-3 py-1 text-xs font-bold ${
                        ch.status === "active"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : ch.status === "pending"
                          ? "bg-amber-500/20 text-amber-300"
                          : ch.status === "frozen"
                          ? "bg-cyan-500/20 text-cyan-300"
                          : ch.status === "completed"
                          ? "bg-[#5865F2]/25 text-[#79A9FF]"
                          : "bg-rose-500/20 text-rose-300"
                      }`}
                    >
                      {ch.status === "pending" && "⏳ بانتظار الموافقات"}
                      {ch.status === "active" && "🔥 جارٍ الآن"}
                      {ch.status === "frozen" && "❄️ مجمد للمراجعة"}
                      {ch.status === "completed" &&
                        (ch.winnerTeam === "tie"
                          ? "🤝 تعادل"
                          : `🏆 فوز الفريق ${ch.winnerTeam}`)}
                      {ch.status === "cancelled" && "🛑 ملغى"}
                      {ch.status === "expired" && "⌛ منتهي الصلاحية"}
                    </span>
                  </div>

                  {ch.isSecretPhase && (
                    <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-200">
                      <EyeOff className="h-4 w-4 shrink-0" />
                      سرية النتائج مفعّلة: يظهر وقتك الموثق فقط ولا تظهر نتائج فريقك أو الفريق المنافس حتى نهاية التحدي.
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {[
                      { label: "الفريق A", list: teamA, total: ch.teamATotal },
                      { label: "الفريق B", list: teamB, total: ch.teamBTotal },
                    ].map((team) => (
                      <div key={team.label} className="rounded-xl bg-[#101426]/80 p-3.5">
                        <div className="mb-2 flex items-center justify-between text-xs font-bold">
                          <span className="text-[#79A9FF]">{team.label}</span>
                          <span className="text-[#FFD166]">
                            {team.total !== null ? `${team.total} د موثقة` : "🔒 سري"}
                          </span>
                        </div>
                        <div className="space-y-1.5 text-xs">
                          {team.list.map((p) => (
                            <div key={p.userId} className="flex items-center justify-between">
                              <span className="text-slate-200">
                                {p.discordName}{" "}
                                {p.inviteStatus === "pending" && "(بانتظار الرد)"}
                                {p.inviteStatus === "withdrawn" && "(منسحب)"}
                              </span>
                              <span className="font-mono text-cyan-300">
                                {p.verifiedMinutes !== null ? `${p.verifiedMinutes} د` : "🔒"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-2">
                    {ch.status === "pending" && myParticipant?.inviteStatus === "pending" && (
                      <>
                        <button
                          onClick={() =>
                            onAction(`/api/challenges/${ch.id}/respond`, { decision: "accept" })
                          }
                          className="flex items-center gap-1 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500"
                        >
                          <UserCheck className="h-3.5 w-3.5" /> قبول التحدي
                        </button>
                        <button
                          onClick={() =>
                            onAction(`/api/challenges/${ch.id}/respond`, { decision: "decline" })
                          }
                          className="flex items-center gap-1 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500"
                        >
                          <XCircle className="h-3.5 w-3.5" /> رفض
                        </button>
                      </>
                    )}

                    {(ch.status === "pending" || ch.status === "active") &&
                      myParticipant &&
                      myParticipant.inviteStatus === "accepted" && (
                        <button
                          onClick={() => onAction(`/api/challenges/${ch.id}/withdraw`, {})}
                          className="rounded-xl bg-[#303954] px-3.5 py-2 text-xs font-bold text-slate-200 hover:bg-[#3f4b6e]"
                        >
                          انسحاب
                        </button>
                      )}

                    {ch.status === "active" && (
                      <button
                        onClick={() =>
                          onAction(`/api/challenges/${ch.id}/settle`, { forceComplete: true })
                        }
                        className="flex items-center gap-1 rounded-xl bg-[#5865F2] px-4 py-2 text-xs font-bold text-white hover:bg-[#4752C4]"
                      >
                        <Lock className="h-3.5 w-3.5" /> إنهاء وتسوية التحدي
                      </button>
                    )}

                    {state.user.isAdmin && (ch.status === "active" || ch.status === "frozen") && (
                      <>
                        {ch.status === "active" && (
                          <button
                            onClick={() =>
                              onAction(`/api/admin/challenges/${ch.id}/freeze`, {
                                reason: "مراجعة السجلات من الإدارة",
                              })
                            }
                            className="flex items-center gap-1 rounded-xl bg-cyan-700 px-3 py-2 text-xs font-bold text-white"
                          >
                            <ShieldAlert className="h-3.5 w-3.5" /> تجميد
                          </button>
                        )}
                        <button
                          onClick={() =>
                            onAction(`/api/admin/challenges/${ch.id}/cancel`, {
                              reason: "إلغاء إداري مع إعادة الرهانات",
                            })
                          }
                          className="rounded-xl bg-rose-700 px-3 py-2 text-xs font-bold text-white"
                        >
                          إلغاء وإرجاع الرهانات
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
