import React, { useState } from "react";
import { ShieldCheck, UserPlus } from "lucide-react";
import { GenderKey } from "../data/botData";
import { SYSTEM_CONFIG } from "../config/settings";

interface RegistrationViewProps {
  defaultName: string;
  onRegister: (input: {
    discordName: string;
    gender: GenderKey;
    acceptRules: boolean;
  }) => Promise<void>;
}

export const RegistrationView: React.FC<RegistrationViewProps> = ({
  defaultName,
  onRegister,
}) => {
  const [discordName, setDiscordName] = useState(defaultName || "");
  const [gender, setGender] = useState<GenderKey>("male");
  const [acceptRules, setAcceptRules] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="mx-auto max-w-2xl rounded-[28px] border-2 border-[#5865F2] bg-[#191F38] p-6 shadow-2xl sm:p-8">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#5865F2] text-white">
          <UserPlus className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-2xl font-extrabold text-white">التسجيل الإلزامي في Study Bot</h2>
          <p className="text-sm text-slate-300">
            أنشئ حسابك وحسابك البنكي قبل الدخول إلى غرف الدراسة والتحديات والمتجر.
          </p>
        </div>
      </div>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await onRegister({ discordName, gender, acceptRules });
          setBusy(false);
        }}
        className="space-y-5"
      >
        <div>
          <label htmlFor="reg-discord-name" className="mb-1.5 block text-sm font-bold text-slate-200">
            اسم Discord الحالي (لن نطلب اسمك الحقيقي)
          </label>
          <input
            id="reg-discord-name"
            type="text"
            required
            minLength={2}
            maxLength={32}
            value={discordName}
            onChange={(e) => setDiscordName(e.target.value)}
            className="w-full rounded-xl border border-[#35446D] bg-[#101426] px-4 py-3 text-white outline-none focus:border-[#568BFF]"
          />
        </div>

        <div>
          <span className="mb-2 block text-sm font-bold text-slate-200">
            اختيار الجنس (إلزامي للشخصية)
          </span>
          <div className="grid grid-cols-2 gap-3">
            {(["male", "female"] as GenderKey[]).map((g) => (
              <button
                type="button"
                key={g}
                onClick={() => setGender(g)}
                className={`rounded-xl border py-3 text-sm font-bold transition ${
                  gender === g
                    ? "border-[#568BFF] bg-[#5865F2] text-white"
                    : "border-[#35446D] bg-[#101426] text-slate-300"
                }`}
              >
                {g === "male" ? "👨 ذكر" : "👩 أنثى"}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[#35446D] bg-[#101426]/80 p-4 text-sm text-slate-300">
          <div className="mb-2 flex items-center gap-2 font-bold text-[#FFD166]">
            <ShieldCheck className="h-4 w-4" />
            قوانين المجتمع والعدالة الدراسية
          </div>
          <ul className="list-disc space-y-1 pr-5 text-xs leading-relaxed text-slate-400">
            <li>يُمنع الغش أو التحايل في مشاركة الشاشة أو التحديات.</li>
            <li>الالتزام بالاحترام العام داخل غرف الدراسة والنقابات.</li>
            <li>تُحفظ جميع العمليات المالية داخل سجل البنك ولا يمكن عكسها إلا وفق القوانين.</li>
          </ul>
          <label className="mt-3 flex cursor-pointer items-center gap-2.5 font-bold text-white">
            <input
              type="checkbox"
              checked={acceptRules}
              onChange={(e) => setAcceptRules(e.target.checked)}
              className="h-4 w-4 accent-[#5865F2]"
            />
            أوافق على قوانين المجتمع وأنشئ حسابي البنكي الإلزامي
          </label>
        </div>

        <button
          type="submit"
          disabled={busy || !acceptRules}
          className="w-full rounded-xl bg-emerald-600 py-3.5 text-base font-extrabold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          إكمال التسجيل واستلام مكافأة {SYSTEM_CONFIG.REGISTRATION_BONUS} 🪙
        </button>
      </form>
    </div>
  );
};
