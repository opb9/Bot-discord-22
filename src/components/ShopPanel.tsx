import React, { useState } from "react";
import { Check, History, Package, Sparkles } from "lucide-react";
import { BACKGROUNDS, CUSTOM_BG_PRICE, THEMES } from "../data/botData";
import { ProductItem, UserProfile } from "../types";

interface ShopPanelProps {
  user: UserProfile;
  products: ProductItem[];
  onBuy: (productId: string, variant?: string) => Promise<void>;
  onUnequip: (kind: "bg" | "theme" | "quote") => Promise<void>;
  onRequestCustomBg: (idea: string) => Promise<void>;
}

export const ShopPanel: React.FC<ShopPanelProps> = ({
  user,
  products,
  onBuy,
  onUnequip,
  onRequestCustomBg,
}) => {
  const [tab, setTab] = useState<"characters" | "jobs" | "bg" | "theme" | "quote" | "inventory" | "custom">("characters");
  const [jobTier, setJobTier] = useState<"all" | "t1" | "t2" | "t3" | "t4" | "t5">("all");
  const [customIdea, setCustomIdea] = useState("");
  const [busy, setBusy] = useState(false);

  const onePieceChars = products.filter((p) => p.kind === "character");
  const allJobs = products.filter((p) => p.kind === "job" && p.id !== "student");
  const jobs = allJobs.filter((j) => {
    const lv = j.min_level || 1;
    if (jobTier === "t1") return lv <= 4;
    if (jobTier === "t2") return lv >= 5 && lv <= 11;
    if (jobTier === "t3") return lv >= 12 && lv <= 19;
    if (jobTier === "t4") return lv >= 20 && lv <= 29;
    if (jobTier === "t5") return lv >= 30;
    return true;
  });
  const bgs = products.filter((p) => p.kind === "bg");
  const themes = products.filter((p) => p.kind === "theme");
  const quotes = products.filter((p) => p.kind === "quote");

  const owns = (productId: string, variant = "default") =>
    user.inventory.some((i) => i.product_id === productId && i.variant === variant);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#35446D] bg-[#191F38] p-4">
        <div className="flex flex-wrap gap-2">
          {[
            { id: "characters", label: "🏴‍☠️ شخصيات خاصة (One Piece)" },
            { id: "jobs", label: "💼 المهن والهويات" },
            { id: "bg", label: "🖼️ الخلفيات" },
            { id: "theme", label: "🎨 الثيمات" },
            { id: "quote", label: "💬 العبارات" },
            { id: "inventory", label: "🎒 المخزون والمشتريات" },
            { id: "custom", label: "🌟 خلفية مخصصة" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as typeof tab)}
              className={`rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                tab === t.id
                  ? "bg-[#5865F2] text-white"
                  : "bg-[#101426] text-slate-300 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user.engagement?.shopDiscountPct > 0 && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/50 px-3 py-2 text-xs font-extrabold text-emerald-300">
              🔖 خصم الدراسة الدائم: {user.engagement.shopDiscountPct}%
            </div>
          )}
          <div className="rounded-xl border border-[#FFD166]/30 bg-[#101426] px-4 py-2 text-sm font-bold text-[#FFD166]">
            متاح بالبنك: {user.coins.toLocaleString()} 🪙
          </div>
        </div>
      </div>

      {tab === "characters" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {onePieceChars.map((ch) => {
            const owned = owns(ch.id, "default");
            const active = user.job === ch.id;
            return (
              <div
                key={ch.id}
                className="flex flex-col justify-between rounded-2xl border border-[#35446D] bg-[#191F38] p-5"
                style={{ borderTopColor: ch.color, borderTopWidth: 4 }}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-3xl">{ch.emoji}</span>
                    <span className="rounded-lg bg-[#101426] px-3 py-1 text-xs font-extrabold text-[#FFD166]">
                      {ch.price.toLocaleString()} 🪙
                    </span>
                  </div>
                  <h3 className="mt-3 text-xl font-extrabold text-white">{ch.name}</h3>
                  <p className="mt-1 text-xs text-slate-400">{ch.title}</p>
                </div>
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await onBuy(ch.id, "default");
                    setBusy(false);
                  }}
                  className={`mt-5 w-full rounded-xl py-2.5 text-sm font-bold text-white transition ${
                    active
                      ? "bg-emerald-600"
                      : owned
                      ? "bg-[#303954] hover:bg-[#3f4b6e]"
                      : "bg-[#5865F2] hover:bg-[#4752C4]"
                  }`}
                >
                  {active ? "✓ شخصية مفعّلة" : owned ? "تفعيل الشخصية" : `شراء بـ ${ch.price.toLocaleString()} 🪙`}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {tab === "jobs" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#35446D]/70 bg-[#191F38] p-4 text-xs">
            <div className="flex flex-wrap gap-2">
              {[
                { id: "all", label: `الكل (${allJobs.length})` },
                { id: "t1", label: "المبتدئة (Lv.1+)" },
                { id: "t2", label: "المتوسطة (Lv.5+)" },
                { id: "t3", label: "المتقدمة (Lv.12+)" },
                { id: "t4", label: "القيادية (Lv.20+)" },
                { id: "t5", label: "الأسطورية (Lv.30+)" },
              ].map((tier) => (
                <button
                  key={tier.id}
                  onClick={() => setJobTier(tier.id as typeof jobTier)}
                  className={`rounded-xl px-3 py-1.5 font-bold transition ${
                    jobTier === tier.id
                      ? "bg-[#5865F2] text-white"
                      : "bg-[#101426] text-slate-300 hover:text-white"
                  }`}
                >
                  {tier.label}
                </button>
              ))}
            </div>
            <div className="text-slate-400">
              مستواك الحالي: <strong className="text-[#8DE0B2]">Lv.{user.level}</strong> • استلام الراتب يتطلب تحقيق دقائق الدراسة الأسبوعية
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {jobs.map((j) => {
              const ownsF = owns(j.id, "female");
              const ownsM = owns(j.id, "male");
              const actF = user.job === j.id && user.gender === "female";
              const actM = user.job === j.id && user.gender === "male";
              const minLv = j.min_level || 1;
              const lockedByLevel = user.level < minLv && !ownsF && !ownsM;
              const previewSrc = `/avatars/${j.id}_${user.gender || "male"}.png`;

              return (
                <div
                  key={j.id}
                  className="flex flex-col justify-between rounded-2xl border border-[#35446D] bg-[#191F38] p-5"
                  style={{ borderTopColor: j.color, borderTopWidth: 4 }}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-base font-extrabold text-white">
                          {j.emoji} {j.title}
                        </h3>
                        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                          <span
                            className={`rounded-md px-2 py-0.5 font-bold ${
                              user.level >= minLv
                                ? "bg-emerald-950/60 text-emerald-300"
                                : "bg-rose-950/60 text-rose-300"
                            }`}
                          >
                            {user.level >= minLv ? `Lv.${minLv}+` : `🔒 يتطلب Lv.${minLv}`}
                          </span>
                          <span className="rounded-md bg-[#101426] px-2 py-0.5 font-bold text-cyan-300">
                            الراتب: +{(j.salary || 0).toLocaleString()} 🪙/أسبوع
                          </span>
                        </div>
                      </div>
                      <span className="shrink-0 rounded-lg bg-[#101426] px-2.5 py-1 text-xs font-extrabold text-[#FFD166]">
                        {j.price.toLocaleString()} 🪙
                      </span>
                    </div>

                    <div className="mt-3 flex items-center gap-3 rounded-xl bg-[#101426]/80 p-3">
                      <img
                        src={previewSrc}
                        alt={j.title}
                        onError={(e) => {
                          if (j.image_path && e.currentTarget.src !== j.image_path) {
                            e.currentTarget.src = j.image_path;
                          }
                        }}
                        className="h-16 w-16 shrink-0 object-contain"
                      />
                      <div className="space-y-1 text-xs text-slate-300">
                        <div>👩 {j.female_label}</div>
                        <div>👨 {j.male_label}</div>
                        <div className="text-[11px] text-slate-400">
                          ⏳ شرط الراتب: {j.required_week_minutes || 120} د/أسبوع
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      disabled={busy || (lockedByLevel && !ownsF)}
                      onClick={async () => {
                        setBusy(true);
                        await onBuy(j.id, "female");
                        setBusy(false);
                      }}
                      className={`rounded-xl py-2 text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        actF ? "bg-emerald-600" : ownsF ? "bg-[#303954]" : "bg-[#5865F2]"
                      }`}
                    >
                      {actF
                        ? "✓ مفعّلة"
                        : ownsF
                        ? `تفعيل (${j.female_label})`
                        : lockedByLevel
                        ? `🔒 Lv.${minLv}`
                        : `شراء (${j.female_label})`}
                    </button>
                    <button
                      disabled={busy || (lockedByLevel && !ownsM)}
                      onClick={async () => {
                        setBusy(true);
                        await onBuy(j.id, "male");
                        setBusy(false);
                      }}
                      className={`rounded-xl py-2 text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        actM ? "bg-emerald-600" : ownsM ? "bg-[#303954]" : "bg-[#5865F2]"
                      }`}
                    >
                      {actM
                        ? "✓ مفعّل"
                        : ownsM
                        ? `تفعيل (${j.male_label})`
                        : lockedByLevel
                        ? `🔒 Lv.${minLv}`
                        : `شراء (${j.male_label})`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "bg" && (
        <div className="space-y-4">
          {user.bg && (
            <button
              onClick={() => onUnequip("bg")}
              className="rounded-xl bg-[#303954] px-4 py-2 text-xs font-bold text-white"
            >
              ⛔ إزالة الخلفية الحالية
            </button>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {bgs.map((item) => {
              const key = item.id.replace(/^bg:/, "");
              const owned = owns(item.id);
              const active = user.bg === key;
              return (
                <div key={item.id} className="overflow-hidden rounded-2xl border border-[#35446D] bg-[#191F38]">
                  <div
                    className="h-24 w-full"
                    style={{ background: BACKGROUNDS[key]?.gradient || "#191F38" }}
                  />
                  <div className="flex items-center justify-between p-4">
                    <div>
                      <div className="font-bold text-white">{item.name}</div>
                      <div className="text-xs text-[#FFD166]">
                        {owned ? "في المخزون ✓" : `${item.price.toLocaleString()} 🪙`}
                      </div>
                    </div>
                    <button
                      onClick={() => onBuy(item.id)}
                      className={`rounded-xl px-4 py-2 text-xs font-bold text-white ${
                        active ? "bg-emerald-600" : owned ? "bg-[#303954]" : "bg-[#5865F2]"
                      }`}
                    >
                      {active ? "مفعّلة" : owned ? "تفعيل" : "شراء"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "theme" && (
        <div className="space-y-4">
          {user.theme && (
            <button
              onClick={() => onUnequip("theme")}
              className="rounded-xl bg-[#303954] px-4 py-2 text-xs font-bold text-white"
            >
              ⛔ إزالة الثيم
            </button>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {themes.map((item) => {
              const key = item.id.replace(/^theme:/, "");
              const owned = owns(item.id);
              const active = user.theme === key;
              return (
                <div key={item.id} className="rounded-2xl border border-[#35446D] bg-[#191F38] p-4">
                  <div className="flex items-center gap-3">
                    <span
                      className="h-8 w-8 rounded-lg border border-white/20"
                      style={{ backgroundColor: THEMES[key]?.color || item.color }}
                    />
                    <div>
                      <div className="font-bold text-white">{item.name}</div>
                      <div className="text-xs text-[#FFD166]">
                        {owned ? "مملوك ✓" : `${item.price.toLocaleString()} 🪙`}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => onBuy(item.id)}
                    className={`mt-4 flex w-full items-center justify-center gap-1 rounded-xl py-2 text-xs font-bold text-white ${
                      active ? "bg-emerald-600" : owned ? "bg-[#303954]" : "bg-[#5865F2]"
                    }`}
                  >
                    {active ? <><Check className="h-3.5 w-3.5" /> مفعّل</> : owned ? "تفعيل" : "شراء"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "quote" && (
        <div className="space-y-4">
          {user.quote && (
            <button
              onClick={() => onUnequip("quote")}
              className="rounded-xl bg-[#303954] px-4 py-2 text-xs font-bold text-white"
            >
              ⛔ إزالة العبارة
            </button>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {quotes.map((item) => {
              const key = item.id.replace(/^quote:/, "");
              const owned = owns(item.id);
              const active = user.quote === key;
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-[#35446D] bg-[#191F38] p-4"
                >
                  <div>
                    <div className="font-bold text-white">💬 {item.name}</div>
                    <div className="text-xs text-[#FFD166]">
                      {owned ? "مملوكة ✓" : `${item.price.toLocaleString()} 🪙`}
                    </div>
                  </div>
                  <button
                    onClick={() => onBuy(item.id)}
                    className={`rounded-xl px-4 py-2 text-xs font-bold text-white ${
                      active ? "bg-emerald-600" : owned ? "bg-[#303954]" : "bg-[#5865F2]"
                    }`}
                  >
                    {active ? "مفعّلة" : owned ? "تفعيل" : "شراء"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "inventory" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-[#35446D] bg-[#191F38] p-5">
            <h3 className="mb-3 flex items-center gap-2 font-extrabold text-white">
              <Package className="h-5 w-5 text-[#79A9FF]" />
              مخزوني ({user.inventory.length})
            </h3>
            {user.inventory.length === 0 ? (
              <p className="text-sm text-slate-400">المخزون فارغ حالياً.</p>
            ) : (
              <div className="space-y-2 text-sm">
                {user.inventory.map((inv, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-xl bg-[#101426]/70 px-3 py-2"
                  >
                    <span>
                      {inv.emoji} {inv.name} <span className="text-xs text-slate-400">({inv.variant})</span>
                    </span>
                    <button
                      onClick={() => onBuy(inv.product_id, inv.variant)}
                      className="rounded-lg bg-[#5865F2] px-3 py-1 text-xs font-bold text-white"
                    >
                      تفعيل
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[#35446D] bg-[#191F38] p-5">
            <h3 className="mb-3 flex items-center gap-2 font-extrabold text-white">
              <History className="h-5 w-5 text-[#FFD166]" />
              سجل المشتريات السابقة
            </h3>
            {user.purchaseHistory.length === 0 ? (
              <p className="text-sm text-slate-400">لا توجد مشتريات مسجلة بعد.</p>
            ) : (
              <div className="space-y-2 text-xs">
                {user.purchaseHistory.map((ph) => (
                  <div
                    key={ph.id}
                    className="flex items-center justify-between rounded-xl bg-[#101426]/70 px-3 py-2"
                  >
                    <span className="font-bold text-white">
                      {ph.emoji} {ph.name}
                    </span>
                    <span className="text-[#FFD166]">{ph.price_paid.toLocaleString()} 🪙</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "custom" && (
        <div className="rounded-2xl border border-[#35446D] bg-[#191F38] p-6">
          <div className="mb-2 flex items-center gap-2 text-lg font-bold text-white">
            <Sparkles className="h-5 w-5 text-[#FFD166]" />
            🌟 طلب خلفية مخصصة ({CUSTOM_BG_PRICE.toLocaleString()} 🪙)
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await onRequestCustomBg(customIdea);
              setCustomIdea("");
            }}
            className="space-y-4"
          >
            <textarea
              value={customIdea}
              onChange={(e) => setCustomIdea(e.target.value)}
              required
              rows={3}
              placeholder="صف الخلفية التي تريدها..."
              className="w-full rounded-xl border border-[#35446D] bg-[#101426] p-3 text-sm text-white"
            />
            <button
              type="submit"
              className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white"
            >
              إرسال الطلب ({CUSTOM_BG_PRICE.toLocaleString()} 🪙)
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
