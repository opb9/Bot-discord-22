import React, { useState } from "react";
import { Download, Edit3, Landmark, Shield, Sparkles } from "lucide-react";
import {
  BACKGROUNDS,
  LOOKS,
  MAX_LEVEL,
  SHOP_QUOTES,
  STUDENT_AFTER_MIN,
  THEMES,
} from "../data/botData";
import { ProductItem, UserProfile } from "../types";

interface ProfileCardProps {
  user: UserProfile;
  products: ProductItem[];
  onSaveBio: (bio: string) => Promise<void>;
  onSaveName: (name: string) => Promise<void>;
}

export const ProfileCard: React.FC<ProfileCardProps> = ({
  user,
  products,
  onSaveBio,
  onSaveName,
}) => {
  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState(user.bio ?? "");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(user.name);
  const [busy, setBusy] = useState(false);

  const jobProduct = user.job ? products.find((p) => p.id === user.job) : null;
  const hasJobAndLook = Boolean(jobProduct && user.gender);
  const jobTitle = hasJobAndLook
    ? `${jobProduct!.emoji} ${
        user.gender === "male"
          ? jobProduct!.male_label || jobProduct!.name
          : jobProduct!.female_label || jobProduct!.name
      }`
    : "بدون شخصية بعد";

  const themeColor =
    user.theme && THEMES[user.theme]
      ? THEMES[user.theme].color
      : jobProduct?.color ?? "#4169E1";

  const bgGradient =
    user.bg && BACKGROUNDS[user.bg] ? BACKGROUNDS[user.bg].gradient : undefined;

  const hours = Math.floor(user.minutes / 60);
  const mins = user.minutes % 60;
  const progressPct =
    user.level >= MAX_LEVEL
      ? 100
      : Math.min(100, Math.round((user.xpCur / Math.max(1, user.xpNeed)) * 100));

  const avatarUrl =
    user.avatarUrl ||
    (user.job === "programmer" && user.gender === "male" ? "/avatars/programmer_male.png" : null);

  const handleDownloadCard = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1100;
    canvas.height = 560;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#101426";
    ctx.fillRect(0, 0, 1100, 560);

    ctx.fillStyle = "#191F38";
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(15, 15, 1070, 530, 35);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "#35446D";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(500, 55);
    ctx.lineTo(500, 505);
    ctx.stroke();

    const right = 1035;
    ctx.textAlign = "right";
    ctx.direction = "rtl";

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 36px Cairo, sans-serif";
    ctx.fillText(user.name, right, 95);

    ctx.fillStyle = "#79A9FF";
    ctx.font = "25px Cairo, sans-serif";
    ctx.fillText(jobTitle, right, 150);

    ctx.strokeStyle = "#35446D";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(540, 190);
    ctx.lineTo(right, 190);
    ctx.stroke();

    ctx.fillStyle = "#FFD166";
    ctx.fillText(`رصيد البنك: ${user.coins.toLocaleString()} 🪙`, right, 240);

    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(
      `وقت الدراسة: ${hours} ساعة و${mins} دقيقة (${user.verifiedMinutes} موثقة)`,
      right,
      300
    );

    ctx.fillStyle = "#8DE0B2";
    ctx.fillText(`المستوى: ${user.level}`, right, 360);

    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(`الخبرة: ${user.xpCur} / ${user.xpNeed} XP`, right, 420);

    ctx.fillStyle = "#303954";
    ctx.beginPath();
    ctx.roundRect(550, 465, right - 550, 25, 12);
    ctx.fill();

    const fillW = Math.round(((right - 550) * progressPct) / 100);
    if (fillW > 0) {
      ctx.fillStyle = "#568BFF";
      ctx.beginPath();
      ctx.roundRect(550, 465, fillW, 25, 12);
      ctx.fill();
    }

    const finishExport = () => {
      const link = document.createElement("a");
      link.download = `profile_${user.id}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    };

    if (avatarUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const scale = Math.min(440 / img.width, 490 / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, 35 + (440 - w) / 2, 35 + (490 - h) / 2, w, h);
        finishExport();
      };
      img.onerror = finishExport;
      img.src = avatarUrl;
    } else {
      ctx.textAlign = "center";
      ctx.font = "130px sans-serif";
      ctx.fillText(jobProduct?.emoji ?? "🎒", 255, 300);
      ctx.fillStyle = "#79A9FF";
      ctx.font = "bold 24px Cairo, sans-serif";
      ctx.fillText(jobTitle, 255, 370);
      finishExport();
    }
  };

  return (
    <div className="space-y-6">
      <div
        className="rounded-[28px] border-2 p-6 shadow-2xl transition-all"
        style={{
          background: bgGradient ?? "#191F38",
          borderColor: themeColor,
        }}
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="flex flex-col justify-between space-y-5 lg:col-span-7">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#35446D] pb-4">
              <div>
                {editingName ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      maxLength={32}
                      className="rounded-lg border border-[#4169E1] bg-[#101426] px-3 py-1.5 text-lg font-bold text-white outline-none"
                    />
                    <button
                      onClick={async () => {
                        setBusy(true);
                        await onSaveName(nameDraft);
                        setBusy(false);
                        setEditingName(false);
                      }}
                      disabled={busy}
                      className="rounded-lg bg-[#5865F2] px-3 py-1.5 text-sm font-semibold text-white"
                    >
                      حفظ
                    </button>
                    <button
                      onClick={() => setEditingName(false)}
                      className="rounded-lg bg-[#303954] px-3 py-1.5 text-sm text-slate-300"
                    >
                      إلغاء
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h2 className="text-3xl font-extrabold text-white">{user.name}</h2>
                    <button
                      onClick={() => {
                        setNameDraft(user.name);
                        setEditingName(true);
                      }}
                      aria-label="تعديل الاسم"
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-[#303954] hover:text-white"
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>
                  </div>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold text-[#79A9FF]">{jobTitle}</span>
                  {user.guild && (
                    <span className="rounded-lg border border-[#5865F2]/40 bg-[#5865F2]/15 px-2.5 py-0.5 text-xs font-bold text-[#79A9FF]">
                      {user.guild.emblem} {user.guild.name}
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={handleDownloadCard}
                className="flex items-center gap-2 rounded-xl border border-[#35446D] bg-[#101426]/80 px-3.5 py-2 text-sm font-semibold text-slate-200 transition hover:border-[#568BFF] hover:text-white"
              >
                <Download className="h-4 w-4 text-[#568BFF]" />
                تحميل البطاقة PNG
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[#35446D]/70 bg-[#101426]/65 p-3.5">
                <div className="text-xs text-slate-400">🏦 رصيد البنك المتاح</div>
                <div className="mt-1 text-xl font-bold text-[#FFD166]">
                  {user.coins.toLocaleString()}
                </div>
                {user.reservedBalance > 0 && (
                  <div className="text-[11px] text-amber-300">
                    محجوز للتحديات: {user.reservedBalance.toLocaleString()}
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-[#35446D]/70 bg-[#101426]/65 p-3.5">
                <div className="text-xs text-slate-400">📚 الدراسة الكلية</div>
                <div className="mt-1 text-lg font-bold text-white">
                  {hours} س و{mins} د
                </div>
                <div className="text-[11px] text-cyan-300">
                  🖥️ موثقة بالشاشة: {user.verifiedMinutes} د
                </div>
              </div>
              <div className="rounded-2xl border border-[#35446D]/70 bg-[#101426]/65 p-3.5">
                <div className="text-xs text-slate-400">⭐ المستوى</div>
                <div className="mt-1 text-xl font-bold text-[#8DE0B2]">
                  {user.level} / {MAX_LEVEL}
                </div>
              </div>
              <div className="rounded-2xl border border-[#35446D]/70 bg-[#101426]/65 p-3.5">
                <div className="text-xs text-slate-400">🔥 أيام متتالية</div>
                <div className="mt-1 text-lg font-bold text-orange-400">{user.streak} يوم</div>
              </div>
              <div className="rounded-2xl border border-[#35446D]/70 bg-[#101426]/65 p-3.5">
                <div className="text-xs text-slate-400">⚔️ التحديات</div>
                <div className="mt-1 text-sm font-bold text-white">
                  {user.challengeRecord.wins} فوز / {user.challengeRecord.played} مباراة
                </div>
              </div>
              {user.debt > 0 && (
                <div className="rounded-2xl border border-rose-500/40 bg-rose-950/30 p-3.5">
                  <div className="text-xs text-rose-300">💳 القرض المتبقي</div>
                  <div className="mt-1 text-lg font-bold text-rose-400">
                    {user.debt.toLocaleString()}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-2xl bg-[#101426]/65 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-200">📈 التقدم إلى المستوى التالي</span>
                <span className="font-mono text-slate-300">
                  {user.level >= MAX_LEVEL
                    ? "المستوى الأقصى 🏆"
                    : `${user.xpCur} / ${user.xpNeed} XP`}
                </span>
              </div>
              <div className="h-4 w-full overflow-hidden rounded-full bg-[#303954]">
                <div
                  className="h-full rounded-full bg-gradient-to-l from-[#568BFF] to-[#79A9FF] transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            <div className="space-y-2.5 text-sm">
              {user.quote && SHOP_QUOTES[user.quote] && (
                <div className="rounded-xl border border-[#35446D]/60 bg-[#101426]/60 px-4 py-2.5 text-[#FFD166]">
                  💬 {SHOP_QUOTES[user.quote].name}
                </div>
              )}
              {user.bio && (
                <div className="rounded-xl border border-[#35446D]/60 bg-[#101426]/60 px-4 py-2.5 text-slate-200">
                  📝 {user.bio}
                </div>
              )}
              {user.ranks.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400">🎖️ الرتب:</span>
                  {user.ranks.map((r) => (
                    <span
                      key={r.id}
                      className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300"
                    >
                      {r.emoji} {r.name}
                    </span>
                  ))}
                </div>
              )}
              {user.positions.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400">🛡️ الوظائف:</span>
                  {user.positions.map((p) => (
                    <span
                      key={p.id}
                      className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300"
                    >
                      {p.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Avatar Panel */}
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[#35446D] bg-[#101426]/60 p-6 lg:col-span-5">
            {avatarUrl ? (
              <div className="flex flex-col items-center text-center">
                <img
                  src={avatarUrl}
                  alt={jobTitle}
                  className="max-h-[260px] w-auto object-contain drop-shadow-[0_10px_25px_rgba(30,106,240,0.35)]"
                />
                <div className="mt-3 text-base font-bold text-[#79A9FF]">{jobTitle}</div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div
                  className="flex h-36 w-36 items-center justify-center rounded-3xl border-2 text-7xl shadow-inner"
                  style={{
                    borderColor: themeColor,
                    background: "radial-gradient(circle, rgba(86,139,255,0.2), transparent)",
                  }}
                >
                  {jobProduct?.emoji ?? "👤"}
                </div>
                <div className="mt-4 text-xl font-bold text-[#79A9FF]">{jobTitle}</div>
                {!hasJobAndLook && (
                  <p className="mt-2 max-w-xs text-xs leading-relaxed text-slate-400">
                    ادرس {STUDENT_AFTER_MIN} دقائق في غرفة معتمدة لتحصل على شخصية الطالب تلقائياً!
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs text-slate-400">
              <span>الشكل: {user.gender ? LOOKS[user.gender] : "غير محدد"}</span>
              <span>•</span>
              <span className="flex items-center gap-1 font-mono text-slate-300">
                <Landmark className="h-3.5 w-3.5 text-[#FFD166]" />
                {user.accountNumber}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bio Editor */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-[#35446D] bg-[#191F38] p-5">
          <div className="mb-3 flex items-center gap-2 text-base font-bold text-white">
            <Shield className="h-5 w-5 text-emerald-400" />
            حالة الحساب البنكي والتسجيل
          </div>
          <div className="space-y-1.5 text-sm text-slate-300">
            <div>رقم الحساب البنكي: <span className="font-mono text-[#FFD166]">{user.accountNumber}</span></div>
            <div>موافقة القوانين: <span className="text-emerald-400">✓ مكتملة</span></div>
            <div>العناصر المملوكة بالمخزون: <span className="font-bold text-white">{user.inventory.length}</span></div>
          </div>
        </div>

        <div className="rounded-2xl border border-[#35446D] bg-[#191F38] p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-base font-bold text-white">
              <Sparkles className="h-5 w-5 text-[#FFD166]" />
              تعيين البايو (النبذة الشخصية)
            </div>
            {!editingBio && (
              <button
                onClick={() => {
                  setBioDraft(user.bio ?? "");
                  setEditingBio(true);
                }}
                className="text-xs font-semibold text-[#79A9FF] hover:underline"
              >
                تعديل
              </button>
            )}
          </div>
          {editingBio ? (
            <div className="space-y-3">
              <textarea
                value={bioDraft}
                onChange={(e) => setBioDraft(e.target.value)}
                maxLength={150}
                rows={2}
                placeholder="اكتب نبذة قصيرة عنك تظهر على بطاقتك..."
                className="w-full rounded-xl border border-[#35446D] bg-[#101426] p-3 text-sm text-white outline-none focus:border-[#568BFF]"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{bioDraft.length} / 150</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingBio(false)}
                    className="rounded-lg bg-[#303954] px-3 py-1.5 text-xs text-slate-300"
                  >
                    إلغاء
                  </button>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      await onSaveBio(bioDraft);
                      setBusy(false);
                      setEditingBio(false);
                    }}
                    className="rounded-lg bg-[#5865F2] px-4 py-1.5 text-xs font-bold text-white"
                  >
                    حفظ البايو
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="rounded-xl bg-[#101426]/60 p-3 text-sm text-slate-300">
              {user.bio || "لا يوجد بايو بعد — اضغط تعديل لإضافة نبذة."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
