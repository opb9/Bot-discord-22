import React, { useState } from "react";
import { ArrowLeftRight, CreditCard, Landmark, Receipt, Shield, Wallet } from "lucide-react";
import {
  DEFAULT_SALARY,
  JOB_SALARY,
  LOAN_FEE,
  LOAN_MAX,
  LOAN_MIN,
  REPAY_SHARE,
  SALARY_MIN_WEEK_MINUTES,
} from "../data/botData";
import { AppState } from "../types";

interface EconomyPanelProps {
  state: AppState;
  onAction: (url: string, body: unknown) => Promise<boolean>;
}

export const EconomyPanel: React.FC<EconomyPanelProps> = ({ state, onAction }) => {
  const { user, positions, allUsers, products } = state;
  const [transferTo, setTransferTo] = useState(
    allUsers.find((u) => u.id !== user.id && u.registered)?.id || "2"
  );
  const [transferAmount, setTransferAmount] = useState(100);
  const [transferNote, setTransferNote] = useState("");
  const [loanAmount, setLoanAmount] = useState(LOAN_MIN);
  const [repayAmount, setRepayAmount] = useState(500);
  const [busy, setBusy] = useState(false);

  const peers = allUsers.filter((u) => u.id !== user.id && u.registered);
  const jobProducts = products.filter((p) => p.kind === "job");

  return (
    <div className="space-y-6">
      {/* Bank Summary + Transfer */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-2xl border border-[#35446D] bg-[#191F38] p-6 lg:col-span-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-lg font-extrabold text-white">
              <Landmark className="h-5 w-5 text-[#FFD166]" />
              الحساب البنكي
            </div>
            <span className="rounded-lg bg-[#101426] px-3 py-1 font-mono text-xs font-bold text-[#79A9FF]">
              {user.accountNumber}
            </span>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-[#101426] p-4">
              <div className="text-xs text-slate-400">الرصيد المتاح للإنفاق</div>
              <div className="mt-1 text-2xl font-extrabold text-[#FFD166]">
                {user.coins.toLocaleString()} 🪙
              </div>
            </div>
            <div className="rounded-xl bg-[#101426] p-4">
              <div className="text-xs text-slate-400">المحجوز للتحديات</div>
              <div className="mt-1 text-2xl font-extrabold text-cyan-300">
                {user.reservedBalance.toLocaleString()} 🔒
              </div>
            </div>
          </div>

          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-200">
            <ArrowLeftRight className="h-4 w-4 text-[#568BFF]" />
            تحويل بنكي فوري (مع حماية Idempotency)
          </h4>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              await onAction("/api/bank/transfer", {
                toUserId: transferTo,
                amount: transferAmount,
                note: transferNote,
                idempotencyKey: `ui-xfer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              });
              setTransferNote("");
              setBusy(false);
            }}
            className="space-y-3 text-sm"
          >
            <div className="grid grid-cols-2 gap-2">
              <select
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
                className="rounded-xl border border-[#35446D] bg-[#101426] px-3 py-2 text-white"
              >
                {peers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={transferAmount}
                onChange={(e) => setTransferAmount(Number(e.target.value))}
                className="rounded-xl border border-[#35446D] bg-[#101426] px-3 py-2 text-white"
              />
            </div>
            <input
              value={transferNote}
              onChange={(e) => setTransferNote(e.target.value)}
              placeholder="ملاحظة التحويل (اختياري)"
              className="w-full rounded-xl border border-[#35446D] bg-[#101426] px-3 py-2 text-white"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-[#5865F2] py-2.5 font-bold text-white hover:bg-[#4752C4]"
            >
              إرسال التحويل
            </button>
          </form>
        </div>

        {/* Loans (3,000 - 10,000, 50% fee) */}
        <div className="space-y-6 lg:col-span-7">
          <div className="rounded-2xl border border-[#35446D] bg-[#191F38] p-6">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-lg font-extrabold text-white">
                <CreditCard className="h-5 w-5 text-[#FFD166]" />
                نظام القروض المعتمد
              </div>
              <span
                className={`rounded-lg px-3 py-1 text-xs font-bold ${
                  user.debt > 0 ? "bg-rose-500/20 text-rose-300" : "bg-emerald-500/20 text-emerald-300"
                }`}
              >
                {user.debt > 0 ? `💳 المستحق: ${user.debt.toLocaleString()} 🪙` : "✅ لا يوجد قرض نشط"}
              </span>
            </div>
            <p className="mb-4 text-xs leading-relaxed text-slate-400">
              الحد المسموح: من {LOAN_MIN.toLocaleString()} إلى {LOAN_MAX.toLocaleString()} عملة •
              رسوم القرض {Math.round(LOAN_FEE * 100)}% • السداد التلقائي يقتطع{" "}
              {Math.round(REPAY_SHARE * 100)}% من أي دخل أو راتب أو جائزة تحدي.
            </p>

            {user.debt <= 0 ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  await onAction("/api/loans/issue", {
                    amount: loanAmount,
                    idempotencyKey: `ui-loan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  });
                  setBusy(false);
                }}
                className="flex flex-col gap-3 sm:flex-row"
              >
                <input
                  type="number"
                  min={LOAN_MIN}
                  max={LOAN_MAX}
                  step={100}
                  value={loanAmount}
                  onChange={(e) => setLoanAmount(Number(e.target.value))}
                  className="flex-1 rounded-xl border border-[#35446D] bg-[#101426] px-4 py-2.5 text-white"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-[#5865F2] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#4752C4]"
                >
                  طلب قرض (المستحق {Math.ceil(loanAmount * (1 + LOAN_FEE)).toLocaleString()})
                </button>
              </form>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  await onAction("/api/loans/repay", {
                    amount: repayAmount,
                    idempotencyKey: `ui-repay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  });
                  setBusy(false);
                }}
                className="flex flex-col gap-3 sm:flex-row"
              >
                <input
                  type="number"
                  min={1}
                  max={user.debt}
                  value={repayAmount}
                  onChange={(e) => setRepayAmount(Number(e.target.value))}
                  className="flex-1 rounded-xl border border-[#35446D] bg-[#101426] px-4 py-2.5 text-white"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-amber-500"
                >
                  سداد يدوي (/repay)
                </button>
              </form>
            )}
          </div>

          {/* Salaries & Positions */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-[#35446D] bg-[#191F38] p-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 font-extrabold text-white">
                  <Wallet className="h-4 w-4 text-emerald-400" />
                  الرواتب الأسبوعية
                </span>
                <span className="text-xs text-slate-400">
                  {user.weekMinutesLast7} / {SALARY_MIN_WEEK_MINUTES} د
                </span>
              </div>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await onAction("/api/economy/salary", {});
                  setBusy(false);
                }}
                className="mt-2 w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white hover:bg-emerald-500"
              >
                💰 استلام الرواتب إلى البنك
              </button>
              <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px]">
                {jobProducts.map((jp) => (
                  <div key={jp.id} className="flex justify-between rounded-lg bg-[#101426]/70 px-2 py-1">
                    <span>{jp.emoji} {jp.title}</span>
                    <span className="text-[#FFD166]">{JOB_SALARY[jp.id] ?? DEFAULT_SALARY}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-[#35446D] bg-[#191F38] p-5">
              <div className="mb-2 flex items-center gap-2 font-extrabold text-white">
                <Shield className="h-4 w-4 text-[#79A9FF]" />
                الوظائف المعتمدة
              </div>
              <div className="space-y-2 text-xs">
                {positions.map((p) => (
                  <div key={p.id} className="rounded-xl bg-[#101426]/70 p-2.5">
                    <div className="flex justify-between font-bold text-white">
                      <span>{p.name}</span>
                      <span className="text-[#FFD166]">{p.salary} / {p.intervalDays}ي</span>
                    </div>
                    <div className="mt-1 text-slate-400">
                      {p.members && p.members.length > 0 ? p.members.map((m) => m.name).join("، ") : "شاغرة"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Immutable Bank Ledger */}
      <div className="rounded-2xl border border-[#35446D] bg-[#191F38] p-6">
        <h3 className="mb-4 flex items-center gap-2 text-lg font-extrabold text-white">
          <Receipt className="h-5 w-5 text-[#79A9FF]" />
          سجل العمليات البنكية الدائم (Bank Ledger)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-[#35446D] text-slate-400">
              <tr>
                <th className="py-2 pr-2">المعرف</th>
                <th className="py-2">النوع</th>
                <th className="py-2">الوصف</th>
                <th className="py-2">المبلغ</th>
                <th className="py-2">الرصيد بعد</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#35446D]/40">
              {user.ledger.map((tx) => (
                <tr key={tx.id}>
                  <td className="py-2.5 pr-2 font-mono text-slate-400">{tx.txId}</td>
                  <td className="py-2.5 font-semibold text-slate-300">{tx.txType}</td>
                  <td className="py-2.5 text-slate-200">{tx.description}</td>
                  <td
                    className={`py-2.5 font-mono font-bold ${
                      tx.amount >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {tx.amount >= 0 ? `+${tx.amount.toLocaleString()}` : tx.amount.toLocaleString()}
                  </td>
                  <td className="py-2.5 font-mono text-[#FFD166]">
                    {tx.balanceAfter.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
