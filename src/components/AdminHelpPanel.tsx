import React, { useState } from "react";
import { Award, BookText, Coins, DatabaseBackup, DoorOpen, PlusCircle, ShieldAlert, Trash2 } from "lucide-react";
import { HELP_ENTRIES } from "../data/botData";
import { AppState } from "../types";

interface AdminHelpPanelProps {
  state: AppState;
  onAction: (url: string, body: unknown, method?: string) => Promise<boolean>;
  onPing: () => Promise<void>;
}

export const AdminHelpPanel: React.FC<AdminHelpPanelProps> = ({
  state,
  onAction,
  onPing,
}) => {
  const [subTab, setSubTab] = useState<"help" | "admin">(state.user.isAdmin ? "admin" : "help");

  const [roomId, setRoomId] = useState("");
  const [roomName, setRoomName] = useState("");
  const [bankTargetId, setBankTargetId] = useState(state.user.id);
  const [bankAmount, setBankAmount] = useState(5000);
  const [rankName, setRankName] = useState("");
  const [rankEmoji, setRankEmoji] = useState("🎖️");
  const [posName, setPosName] = useState("");
  const [posSalary, setPosSalary] = useState(250);
  const [prodId, setProdId] = useState("");
  const [prodName, setProdName] = useState("");
  const [prodEmoji, setProdEmoji] = useState("🌟");
  const [prodPrice, setProdPrice] = useState(5000);

  const groupedHelp = HELP_ENTRIES.reduce<Record<string, typeof HELP_ENTRIES>>((acc, item) => {
    (acc[item.category] ||= []).push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#35446D] bg-[#191F38] p-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSubTab("help")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold ${
              subTab === "help" ? "bg-[#5865F2] text-white" : "bg-[#101426] text-slate-300"
            }`}
          >
            <BookText className="h-4 w-4" />
            📖 دليل الأوامر (/help)
          </button>
          <button
            onClick={() => setSubTab("admin")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold ${
              subTab === "admin" ? "bg-[#5865F2] text-white" : "bg-[#101426] text-slate-300"
            }`}
          >
            <ShieldAlert className="h-4 w-4" />
            🧰 لوحة الإدارة والنسخ الاحتياطي
          </button>
        </div>

        <button
          onClick={onPing}
          className="rounded-xl border border-[#35446D] bg-[#101426] px-4 py-2 text-xs font-bold text-emerald-300 hover:border-emerald-400"
        >
          ⚡ /ping اختبار النظام
        </button>
      </div>

      {subTab === "help" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Object.entries(groupedHelp).map(([category, items]) => (
            <div key={category} className="rounded-2xl border border-[#35446D] bg-[#191F38] p-5">
              <h3 className="mb-3 text-base font-extrabold text-[#79A9FF]">{category}</h3>
              <div className="space-y-2 text-sm">
                {items.map((item) => (
                  <div key={item.command} className="rounded-xl bg-[#101426]/65 px-3 py-2">
                    <code className="font-mono font-bold text-[#FFD166]">{item.command}</code>
                    <span className="mx-2 text-slate-500">—</span>
                    <span className="text-slate-200">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : !state.user.isAdmin ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-950/30 p-8 text-center text-sm font-bold text-rose-200">
          ⛔ هذه اللوحة تتطلب صلاحيات الإدارة في النظام (مُتحقق منها في الخادم أيضاً).
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Approved Study Rooms */}
          <div className="rounded-2xl border border-[#35446D] bg-[#191F38] p-5">
            <h3 className="mb-3 flex items-center gap-2 font-extrabold text-white">
              <DoorOpen className="h-5 w-5 text-cyan-400" />
              إدارة غرف الدراسة المعتمدة
            </h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await onAction("/api/admin/rooms", { roomId, name: roomName });
                if (ok) {
                  setRoomId("");
                  setRoomName("");
                }
              }}
              className="mb-4 flex gap-2 text-sm"
            >
              <input
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                required
                placeholder="معرف الغرفة (room-4)"
                className="w-36 rounded-xl border border-[#35446D] bg-[#101426] px-3 py-2 text-white"
              />
              <input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                required
                placeholder="اسم الغرفة"
                className="flex-1 rounded-xl border border-[#35446D] bg-[#101426] px-3 py-2 text-white"
              />
              <button
                type="submit"
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white"
              >
                إضافة
              </button>
            </form>
            <div className="space-y-2 text-xs">
              {state.rooms.map((r) => (
                <div
                  key={r.roomId}
                  className="flex items-center justify-between rounded-xl bg-[#101426]/70 px-3 py-2"
                >
                  <span>
                    <strong className="text-white">{r.name}</strong>{" "}
                    <span className="font-mono text-slate-400">({r.roomId})</span>
                  </span>
                  <button
                    onClick={() => onAction(`/api/admin/rooms/${r.roomId}`, {}, "DELETE")}
                    className="rounded-lg p-1 text-rose-400 hover:bg-rose-500/20"
                    aria-label={`حذف ${r.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Bank Adjustment */}
          <div className="rounded-2xl border border-[#35446D] bg-[#191F38] p-5">
            <h3 className="mb-3 flex items-center gap-2 font-extrabold text-white">
              <Coins className="h-5 w-5 text-[#FFD166]" />
              تعديل الرصيد البنكي (إيداع / سحب إداري)
            </h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await onAction("/api/admin/bank/adjust", {
                  targetUserId: bankTargetId,
                  amount: bankAmount,
                });
              }}
              className="space-y-3 text-sm"
            >
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={bankTargetId}
                  onChange={(e) => setBankTargetId(e.target.value)}
                  className="rounded-xl border border-[#35446D] bg-[#101426] px-3 py-2 text-white"
                >
                  {state.allUsers
                    .filter((u) => u.registered)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.coins.toLocaleString()} 🪙)
                      </option>
                    ))}
                </select>
                <input
                  type="number"
                  value={bankAmount}
                  onChange={(e) => setBankAmount(Number(e.target.value))}
                  className="rounded-xl border border-[#35446D] bg-[#101426] px-3 py-2 text-white"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-xl bg-[#5865F2] py-2.5 font-bold text-white hover:bg-[#4752C4]"
              >
                تنفيذ العملية في سجل البنك
              </button>
            </form>
          </div>

          {/* Backups */}
          <div className="rounded-2xl border border-[#35446D] bg-[#191F38] p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-extrabold text-white">
                <DatabaseBackup className="h-5 w-5 text-emerald-400" />
                النسخ الاحتياطي والتحقق من السلامة
              </h3>
              <button
                onClick={() => onAction("/api/admin/backups", {})}
                className="rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-500"
              >
                📦 أخذ نسخة احتياطية الآن
              </button>
            </div>
            <div className="space-y-2 text-xs">
              {state.backups.length === 0 ? (
                <p className="text-slate-400">لم تُؤخذ نسخ احتياطية بعد.</p>
              ) : (
                state.backups.map((b) => (
                  <div
                    key={b.filename}
                    className="flex items-center justify-between rounded-xl bg-[#101426]/70 px-3 py-2"
                  >
                    <span className="font-mono text-slate-200">{b.filename}</span>
                    <span className="text-emerald-300">
                      {(b.sizeBytes / 1024).toFixed(1)} KB • ✓ سليمة
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Ranks & Positions & Custom Products */}
          <div className="space-y-4 rounded-2xl border border-[#35446D] bg-[#191F38] p-5">
            <h3 className="flex items-center gap-2 font-extrabold text-white">
              <Award className="h-5 w-5 text-amber-400" />
              الرتب والوظائف وإضافة منتجات المتجر
            </h3>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await onAction("/api/admin/ranks", { name: rankName, emoji: rankEmoji });
                if (ok) setRankName("");
              }}
              className="flex gap-2 text-xs"
            >
              <input
                value={rankEmoji}
                onChange={(e) => setRankEmoji(e.target.value)}
                className="w-14 rounded-xl border border-[#35446D] bg-[#101426] p-2 text-center text-white"
              />
              <input
                value={rankName}
                onChange={(e) => setRankName(e.target.value)}
                required
                placeholder="اسم رتبة جديدة"
                className="flex-1 rounded-xl border border-[#35446D] bg-[#101426] px-3 py-2 text-white"
              />
              <button type="submit" className="rounded-xl bg-[#5865F2] px-3 py-2 font-bold text-white">
                + رتبة
              </button>
            </form>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await onAction("/api/admin/positions", {
                  name: posName,
                  salary: posSalary,
                  intervalDays: 7,
                });
                if (ok) setPosName("");
              }}
              className="flex gap-2 text-xs"
            >
              <input
                value={posName}
                onChange={(e) => setPosName(e.target.value)}
                required
                placeholder="اسم وظيفة جديدة"
                className="flex-1 rounded-xl border border-[#35446D] bg-[#101426] px-3 py-2 text-white"
              />
              <input
                type="number"
                value={posSalary}
                onChange={(e) => setPosSalary(Number(e.target.value))}
                className="w-24 rounded-xl border border-[#35446D] bg-[#101426] px-2 py-2 text-white"
              />
              <button type="submit" className="rounded-xl bg-[#5865F2] px-3 py-2 font-bold text-white">
                + وظيفة
              </button>
            </form>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await onAction("/api/admin/products", {
                  id: prodId,
                  kind: "character",
                  name: prodName,
                  title: prodName,
                  emoji: prodEmoji,
                  price: prodPrice,
                });
                if (ok) {
                  setProdId("");
                  setProdName("");
                }
              }}
              className="grid grid-cols-4 gap-2 text-xs"
            >
              <input
                value={prodId}
                onChange={(e) => setProdId(e.target.value)}
                required
                placeholder="id (zoro)"
                className="rounded-xl border border-[#35446D] bg-[#101426] px-2 py-2 text-white"
              />
              <input
                value={prodName}
                onChange={(e) => setProdName(e.target.value)}
                required
                placeholder="الاسم"
                className="rounded-xl border border-[#35446D] bg-[#101426] px-2 py-2 text-white"
              />
              <input
                type="number"
                value={prodPrice}
                onChange={(e) => setProdPrice(Number(e.target.value))}
                className="rounded-xl border border-[#35446D] bg-[#101426] px-2 py-2 text-white"
              />
              <button
                type="submit"
                className="flex items-center justify-center gap-1 rounded-xl bg-emerald-600 px-2 py-2 font-bold text-white"
              >
                <PlusCircle className="h-3.5 w-3.5" /> شخصية
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
