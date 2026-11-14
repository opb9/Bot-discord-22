import React, { useEffect, useState } from "react";
import {
  BookMarked,
  Camera,
  CheckCircle2,
  FastForward,
  Flame,
  Gift,
  Monitor,
  MonitorOff,
  Play,
  Plus,
  Shield,
  Sparkles,
  Square,
  Timer,
  Trash2,
} from "lucide-react";
import { COIN_PER_MINUTE, HOUR_BONUS } from "../data/botData";
import { ActiveStudySession, EngagementSummary, StudyRoom } from "../types";

interface FocusPanelProps {
  rooms: StudyRoom[];
  activeSession: ActiveStudySession | null;
  engagement: EngagementSummary;
  onAction: (url: string, body: unknown, method?: string) => Promise<boolean>;
}

export const FocusPanel: React.FC<FocusPanelProps> = ({
  rooms,
  activeSession,
  engagement,
  onAction,
}) => {
  const [selectedRoom, setSelectedRoom] = useState(rooms[0]?.roomId || "room-focus-1");
  const [screenOnOnJoin, setScreenOnOnJoin] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [pomodoroTarget, setPomodoroTarget] = useState<number>(25);
  const [simMinutes, setSimMinutes] = useState(25);
  const [nowMs, setNowMs] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  const [subjectName, setSubjectName] = useState("");
  const [subjectExamDate, setSubjectExamDate] = useState("");

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedSec = activeSession
    ? Math.max(0, Math.floor((nowMs - activeSession.startedAt) / 1000))
    : 0;
  const mm = Math.floor(elapsedSec / 60);
  const ss = elapsedSec % 60;

  return (
    <div className="space-y-6">
      {/* Top Hero Row: Active Room + Rules/Streak Multiplier */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-[24px] border border-[#35446D] bg-[#191F38] p-6 lg:col-span-7">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <Timer className="h-6 w-6 text-[#568BFF]" />
              <h2 className="text-xl font-extrabold text-white">نظام الدراسة العادية والموثقة بالشاشة</h2>
            </div>
            <span className="rounded-xl bg-amber-500/15 px-3 py-1 text-xs font-extrabold text-amber-300">
              🔥 مضاعف السلسلة: {engagement.streakMultiplier}x • 🍅 {engagement.pomodoroCount} بومودورو
            </span>
          </div>

          {activeSession ? (
            <div className="space-y-5 rounded-2xl border border-[#4169E1]/50 bg-[#101426] p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-lg bg-[#5865F2]/20 px-3 py-1 text-sm font-bold text-[#79A9FF]">
                  📚 متصل بالغرفة: {activeSession.roomName}
                </span>
                <span
                  className={`rounded-lg px-3 py-1 text-xs font-bold ${
                    activeSession.screenSharing
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-amber-500/20 text-amber-300"
                  }`}
                >
                  {activeSession.screenSharing
                    ? "🖥️ مشاركة الشاشة مفعّلة (دراسة موثقة)"
                    : "🎧 دراسة عادية فقط (بدون مشاركة شاشة)"}
                </span>
              </div>

              <div className="py-2 text-center font-mono text-5xl font-extrabold tracking-wider text-white">
                {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
              </div>

              <div className="flex flex-wrap justify-center gap-3">
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await onAction("/api/study/screen", {
                      screenSharing: !activeSession.screenSharing,
                    });
                    setBusy(false);
                  }}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition ${
                    activeSession.screenSharing
                      ? "bg-amber-600 hover:bg-amber-500"
                      : "bg-emerald-600 hover:bg-emerald-500"
                  }`}
                >
                  {activeSession.screenSharing ? (
                    <>
                      <MonitorOff className="h-4 w-4" /> إيقاف مشاركة الشاشة
                    </>
                  ) : (
                    <>
                      <Monitor className="h-4 w-4" /> تشغيل مشاركة الشاشة (توثيق)
                    </>
                  )}
                </button>

                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await onAction("/api/study/leave", {});
                    setBusy(false);
                  }}
                  className="flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-500"
                >
                  <Square className="h-4 w-4" /> مغادرة الغرفة
                </button>
              </div>

              <div className="border-t border-[#35446D]/60 pt-4">
                <div className="mb-2 text-xs font-semibold text-slate-400">
                  إنهاء وتسجيل جلسة مكتملة مباشرة في SQLite:
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {[10, 25, 45, 50, 60].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSimMinutes(m)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                        simMinutes === m ? "bg-[#5865F2] text-white" : "bg-[#191F38] text-slate-300"
                      }`}
                    >
                      {m} د
                    </button>
                  ))}
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      await onAction("/api/study/simulate-minutes", { minutes: simMinutes });
                      setBusy(false);
                    }}
                    className="mr-auto flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500"
                  >
                    <FastForward className="h-3.5 w-3.5" />
                    اعتماد {simMinutes} دقيقة وإغلاق الجلسة
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                await onAction("/api/study/join", {
                  roomId: selectedRoom,
                  screenSharing: screenOnOnJoin,
                  cameraOn,
                  subjectId: engagement.activeSubjectId,
                  pomodoroTarget,
                });
                setBusy(false);
              }}
              className="space-y-4"
            >
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-300">
                  اختر غرفة دراسة صوتية معتمدة
                </label>
                <select
                  value={selectedRoom}
                  onChange={(e) => setSelectedRoom(e.target.value)}
                  className="w-full rounded-xl border border-[#35446D] bg-[#101426] px-4 py-3 text-white outline-none focus:border-[#568BFF]"
                >
                  {rooms.map((r) => (
                    <option key={r.roomId} value={r.roomId}>
                      {r.name} {r.description ? `— ${r.description}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Pomodoro Preset */}
              <div>
                <span className="mb-1.5 block text-xs font-bold text-slate-300">
                  🍅 نمط الجلسة (مكافأة إتمام دورة بومودورو)
                </span>
                <div className="grid grid-cols-3 gap-2 text-xs font-bold">
                  {[
                    { val: 0, label: "دراسة حرة" },
                    { val: 25, label: "🍅 25د (+15 🪙)" },
                    { val: 50, label: "🔥 50د عميق (+40 🪙)" },
                  ].map((opt) => (
                    <button
                      type="button"
                      key={opt.val}
                      onClick={() => setPomodoroTarget(opt.val)}
                      className={`rounded-xl border py-2.5 transition ${
                        pomodoroTarget === opt.val
                          ? "border-[#568BFF] bg-[#5865F2] text-white"
                          : "border-[#35446D] bg-[#101426] text-slate-300"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[#35446D] bg-[#101426] p-3.5 text-sm">
                  <input
                    type="checkbox"
                    checked={screenOnOnJoin}
                    onChange={(e) => setScreenOnOnJoin(e.target.checked)}
                    className="h-4 w-4 accent-emerald-500"
                  />
                  <div>
                    <div className="flex items-center gap-1.5 font-bold text-emerald-300">
                      <Monitor className="h-4 w-4" /> مشاركة الشاشة
                    </div>
                    <div className="text-xs text-slate-400">شرط احتساب الدراسة الموثقة والتحديات</div>
                  </div>
                </label>

                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[#35446D] bg-[#101426] p-3.5 text-sm">
                  <input
                    type="checkbox"
                    checked={cameraOn}
                    onChange={(e) => setCameraOn(e.target.checked)}
                    className="h-4 w-4 accent-amber-500"
                  />
                  <div>
                    <div className="flex items-center gap-1.5 font-bold text-slate-200">
                      <Camera className="h-4 w-4" /> الكاميرا فقط
                    </div>
                    <div className="text-xs text-slate-400">لا تكفي وحدها للدراسة الموثقة</div>
                  </div>
                </label>
              </div>

              <button
                type="submit"
                disabled={busy || rooms.length === 0}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-6 py-3.5 text-base font-bold text-white transition hover:bg-[#4752C4]"
              >
                <Play className="h-5 w-5" />
                دخول غرفة الدراسة المعتمدة
              </button>
            </form>
          )}
        </div>

        {/* Daily Mystery Chest + Streak Shield + Rules */}
        <div className="space-y-4 rounded-[24px] border border-[#35446D] bg-[#191F38] p-6 lg:col-span-5">
          {/* Mystery Focus Chest */}
          <div className="rounded-2xl border border-amber-500/40 bg-gradient-to-br from-[#1b2240] to-[#12172b] p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-extrabold text-amber-300">
                <Gift className="h-5 w-5" /> صندوق التركيز اليومي
              </h3>
              <span className="text-xs font-bold text-slate-300">
                {engagement.dailyChest.todayMinutes} / {engagement.dailyChest.requiredMinutes} د اليوم
              </span>
            </div>
            <p className="mb-3 text-xs text-slate-300">
              يُفتح بعد إكمال 30 دقيقة دراسة يومياً — يعطي 60–240 عملة × مضاعف السلسلة + فرصة لدرع مجاني!
            </p>
            <button
              disabled={!engagement.dailyChest.unlocked || engagement.dailyChest.claimed}
              onClick={() => onAction("/api/engagement/chest/open", {})}
              className="w-full rounded-xl bg-amber-500 py-2.5 text-xs font-extrabold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {engagement.dailyChest.claimed
                ? `✓ تم فتح الصندوق اليوم (+${engagement.dailyChest.lastReward?.coins ?? 0} 🪙)`
                : engagement.dailyChest.unlocked
                ? "🎁 افتح الصندوق اليومي الآن!"
                : `أكمل ${Math.max(0, engagement.dailyChest.requiredMinutes - engagement.dailyChest.todayMinutes)} د متبقية لفتحه`}
            </button>
          </div>

          {/* Streak Shields */}
          <div className="rounded-2xl border border-[#35446D] bg-[#101426]/80 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-extrabold text-cyan-300">
                <Shield className="h-4 w-4" /> دروع حماية السلسلة
              </span>
              <span className="text-xs font-bold text-white">
                {engagement.streakShields} / {engagement.maxStreakShields} 🛡️
              </span>
            </div>
            <p className="mb-3 text-xs text-slate-400">
              تحمي سلسلة أيامك من الانقطاع إذا فاتك يوم دراسة بسبب امتحان أو انشغال.
            </p>
            <div className="flex gap-2">
              <button
                disabled={engagement.streakShields >= engagement.maxStreakShields}
                onClick={() => onAction("/api/engagement/shields/buy", {})}
                className="flex-1 rounded-xl bg-[#5865F2] py-2 text-xs font-bold text-white hover:bg-[#4752C4] disabled:opacity-50"
              >
                شراء درع ({engagement.shieldPrice} 🪙)
              </button>
              <button
                disabled={engagement.streakShields <= 0}
                onClick={() => onAction("/api/engagement/shields/use", {})}
                className="flex-1 rounded-xl border border-cyan-500/40 bg-cyan-950/40 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-900/50 disabled:opacity-40"
              >
                حماية يوم أمس
              </button>
            </div>
          </div>

          <div className="rounded-xl bg-[#101426]/70 p-3 text-xs text-slate-300">
            🪙 المكافأة الأساسية: <strong className="text-[#FFD166]">{COIN_PER_MINUTE} عملة/دقيقة</strong> +{" "}
            <strong className="text-[#FFD166]">{HOUR_BONUS}</strong> لكل ساعة متواصلة (الدقائق الموثقة جزء من العادية ولا تُضاعف).
          </div>
        </div>
      </div>

      {/* Daily Quests + Study Subjects & Perks */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Daily Quests */}
        <div className="rounded-[24px] border border-[#35446D] bg-[#191F38] p-6 lg:col-span-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-lg font-extrabold text-white">
              <Flame className="h-5 w-5 text-orange-400" />
              المهام اليومية التحفيزية
            </h3>
            <span className="text-xs font-bold text-emerald-300">
              +{engagement.xpBoostPct}% XP • خصم متجر {engagement.shopDiscountPct}%
            </span>
          </div>

          <div className="space-y-3">
            {engagement.quests.map((q) => {
              const pct = Math.min(100, Math.round((q.progressMinutes / q.targetMinutes) * 100));
              return (
                <div key={q.id} className="rounded-2xl border border-[#35446D]/70 bg-[#101426] p-4">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-white">{q.title}</div>
                      <div className="text-xs text-slate-400">{q.description}</div>
                    </div>
                    {q.claimed ? (
                      <span className="flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" /> مُستلمة
                      </span>
                    ) : q.completed ? (
                      <button
                        onClick={() => onAction(`/api/engagement/quests/${q.id}/claim`, {})}
                        className="shrink-0 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-emerald-500"
                      >
                        استلام +{q.finalCoins} 🪙
                      </button>
                    ) : (
                      <span className="shrink-0 text-xs font-bold text-amber-300">
                        +{q.finalCoins} 🪙 • +{q.finalXp} XP
                      </span>
                    )}
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1d2442]">
                    <div
                      className="h-full rounded-full bg-gradient-to-l from-emerald-400 to-[#5865F2]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-1 text-left text-[11px] font-bold text-slate-400">
                    {q.progressMinutes} / {q.targetMinutes} دقيقة
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Subjects Tracker + Exclusive Study Perks */}
        <div className="space-y-6 lg:col-span-6">
          {/* Study Subjects & Exams */}
          <div className="rounded-[24px] border border-[#35446D] bg-[#191F38] p-6">
            <h3 className="mb-3 flex items-center gap-2 text-lg font-extrabold text-white">
              <BookMarked className="h-5 w-5 text-[#79A9FF]" />
              المواد الدراسية ومواعيد الامتحانات
            </h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await onAction("/api/engagement/subjects", {
                  name: subjectName,
                  examDate: subjectExamDate || undefined,
                });
                if (ok) {
                  setSubjectName("");
                  setSubjectExamDate("");
                }
              }}
              className="mb-4 flex flex-wrap gap-2 text-xs"
            >
              <input
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
                required
                placeholder="اسم المادة (مثلاً: الفيزياء)"
                className="min-w-[140px] flex-1 rounded-xl border border-[#35446D] bg-[#101426] px-3 py-2 text-white"
              />
              <input
                type="date"
                value={subjectExamDate}
                onChange={(e) => setSubjectExamDate(e.target.value)}
                aria-label="تاريخ الامتحان"
                className="rounded-xl border border-[#35446D] bg-[#101426] px-3 py-2 text-white"
              />
              <button
                type="submit"
                className="flex items-center gap-1 rounded-xl bg-[#5865F2] px-3.5 py-2 font-bold text-white"
              >
                <Plus className="h-3.5 w-3.5" /> إضافة
              </button>
            </form>

            {engagement.subjects.length === 0 ? (
              <p className="text-xs text-slate-400">
                أضف موادك الدراسية لتتبع ساعات كل مادة والعدّ التنازلي لامتحاناتك.
              </p>
            ) : (
              <div className="space-y-2 text-xs">
                {engagement.subjects.map((sub) => {
                  const isActive = engagement.activeSubjectId === sub.id;
                  return (
                    <div
                      key={sub.id}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${
                        isActive
                          ? "border-emerald-500/60 bg-emerald-950/25"
                          : "border-[#35446D]/60 bg-[#101426]"
                      }`}
                    >
                      <div>
                        <span className="font-bold text-white">{sub.name}</span>
                        <span className="mx-2 text-slate-400">({sub.loggedMinutes} د مسجلة)</span>
                        {sub.examDate && (
                          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                            📅 امتحان: {sub.examDate}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            onAction("/api/engagement/subjects/active", {
                              subjectId: isActive ? null : sub.id,
                            })
                          }
                          className={`rounded-lg px-2.5 py-1 font-bold ${
                            isActive ? "bg-emerald-600 text-white" : "bg-[#191F38] text-slate-300"
                          }`}
                        >
                          {isActive ? "✓ قيد الدراسة" : "تفعيل"}
                        </button>
                        <button
                          aria-label={`حذف مادة ${sub.name}`}
                          onClick={() => onAction(`/api/engagement/subjects/${sub.id}`, {}, "DELETE")}
                          className="rounded-lg p-1 text-rose-400 hover:bg-rose-500/20"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Study-Gated Perks */}
          <div className="rounded-[24px] border border-[#35446D] bg-[#191F38] p-6">
            <h3 className="mb-3 flex items-center gap-2 text-lg font-extrabold text-white">
              <Sparkles className="h-5 w-5 text-[#FFD166]" />
              امتيازات حصرية بساعات الدراسة الحقيقية
            </h3>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {engagement.perks.map((p) => (
                <div
                  key={p.id}
                  className={`rounded-xl border p-3 text-xs ${
                    p.unlocked
                      ? "border-emerald-500/50 bg-emerald-950/25 text-white"
                      : "border-[#35446D]/60 bg-[#101426]/60 text-slate-400"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between font-extrabold">
                    <span>{p.title}</span>
                    <span className={p.unlocked ? "text-emerald-300" : "text-slate-500"}>
                      {p.unlocked ? p.badge : "🔒"}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed">{p.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
