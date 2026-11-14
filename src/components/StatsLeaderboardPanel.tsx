import React, { useEffect, useState } from "react";
import { BarChart3, Flame, Trophy } from "lucide-react";
import { PERIODS } from "../data/botData";
import { LeaderboardRow, StatsPayload } from "../types";

interface StatsLeaderboardPanelProps {
  userId: string;
  refreshSignal: number;
}

export const StatsLeaderboardPanel: React.FC<StatsLeaderboardPanelProps> = ({
  userId,
  refreshSignal,
}) => {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [period, setPeriod] = useState<string>("all");
  const [board, setBoard] = useState<LeaderboardRow[]>([]);

  useEffect(() => {
    fetch(`/api/stats?userId=${encodeURIComponent(userId)}`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, [userId, refreshSignal]);

  useEffect(() => {
    fetch(`/api/leaderboard?period=${period}`)
      .then((r) => r.json())
      .then((d) => setBoard(d.rows || []))
      .catch(() => {});
  }, [period, refreshSignal]);

  const fmt = (m: number) => `${Math.floor(m / 60)} س و${m % 60} د`;
  const medals = ["🥇", "🥈", "🥉"];
  const max7 = stats ? Math.max(1, ...stats.last7Days.map((d) => d.minutes)) : 1;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="space-y-5 rounded-2xl border border-[#35446D] bg-[#191F38] p-6 lg:col-span-7">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-extrabold text-white">
            <BarChart3 className="h-5 w-5 text-cyan-400" />
            إحصاءات الدراسة العادية والموثقة (/stats)
          </div>
          {stats && (
            <span className="flex items-center gap-1 rounded-lg bg-orange-500/15 px-3 py-1 text-xs font-bold text-orange-300">
              <Flame className="h-4 w-4" />
              {stats.streak} يوم متتالي
            </span>
          )}
        </div>

        {stats ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: "⏱️ اليوم", val: fmt(stats.day), sub: `موثقة: ${stats.dayVerified} د` },
                { label: "📅 هذا الأسبوع", val: fmt(stats.week), sub: `موثقة: ${stats.weekVerified} د` },
                { label: "🗓️ هذا الشهر", val: fmt(stats.month) },
                { label: "📆 هذه السنة", val: fmt(stats.year) },
                { label: "🏁 الإجمالي", val: fmt(stats.all), sub: `موثقة: ${stats.allVerified} د` },
                { label: "🔥 أيام متتالية", val: `${stats.streak} يوم` },
              ].map((c) => (
                <div key={c.label} className="rounded-xl bg-[#101426]/80 p-3.5">
                  <div className="text-xs text-slate-400">{c.label}</div>
                  <div className="mt-1 text-base font-bold text-white">{c.val}</div>
                  {c.sub && <div className="text-[11px] text-cyan-300">{c.sub}</div>}
                </div>
              ))}
            </div>

            <div>
              <h4 className="mb-3 text-sm font-bold text-slate-300">📅 آخر 7 أيام</h4>
              <div className="space-y-2.5">
                {stats.last7Days.map((d) => (
                  <div key={d.date} className="flex items-center gap-3 text-xs">
                    <span className="w-28 shrink-0 text-slate-300">{d.label}</span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-[#101426]">
                      <div
                        className="h-full rounded-full bg-[#568BFF]"
                        style={{ width: `${Math.round((d.minutes / max7) * 100)}%` }}
                      />
                    </div>
                    <span className="w-28 text-left font-semibold text-cyan-300">
                      {fmt(d.minutes)} ({d.verifiedMinutes} د🖥️)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="py-10 text-center text-sm text-slate-400">جارٍ تحميل الإحصاءات...</div>
        )}
      </div>

      <div className="rounded-2xl border border-[#35446D] bg-[#191F38] p-6 lg:col-span-5">
        <div className="mb-4 flex items-center gap-2 text-lg font-extrabold text-white">
          <Trophy className="h-5 w-5 text-[#FFD166]" />
          لوحة المتصدرين (/top)
        </div>

        <div className="mb-4 flex flex-wrap gap-1.5">
          {Object.entries(PERIODS).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setPeriod(k)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                period === k
                  ? "bg-[#5865F2] text-white"
                  : "bg-[#101426] text-slate-400 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-2.5">
          {board.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">لا توجد بيانات بعد.</p>
          ) : (
            board.map((row, idx) => (
              <div
                key={row.id}
                className="flex items-center justify-between rounded-xl border border-[#35446D]/60 bg-[#101426]/80 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="w-7 text-center text-base font-extrabold">
                    {idx < 3 ? medals[idx] : `${idx + 1}.`}
                  </span>
                  <div>
                    <div className="font-bold text-white">{row.name}</div>
                    <div className="text-xs text-[#8DE0B2]">
                      مستوى {row.level} • 🖥️ {row.verifiedMinutes} د موثقة
                    </div>
                  </div>
                </div>
                <div className="text-sm font-bold text-[#FFD166]">{fmt(row.minutes)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
