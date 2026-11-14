import React, { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  BookOpen,
  Coins,
  Film,
  Shield,
  ShoppingBag,
  Swords,
  Timer,
  User,
  Wallet,
} from "lucide-react";
import { AdminHelpPanel } from "./components/AdminHelpPanel";
import { ChallengesPanel } from "./components/ChallengesPanel";
import { EconomyPanel } from "./components/EconomyPanel";
import { EntertainmentPanel } from "./components/EntertainmentPanel";
import { FocusPanel } from "./components/FocusPanel";
import { GuildsPanel } from "./components/GuildsPanel";
import { ProfileCard } from "./components/ProfileCard";
import { RegistrationView } from "./components/RegistrationModal";
import { ShopPanel } from "./components/ShopPanel";
import { StatsLeaderboardPanel } from "./components/StatsLeaderboardPanel";
import { AppState } from "./types";

type TabId =
  | "profile"
  | "focus"
  | "challenges"
  | "shop"
  | "economy"
  | "guilds"
  | "stats"
  | "entertainment"
  | "admin";

export const App: React.FC = () => {
  const [viewerId, setViewerId] = useState<string>("1");
  const [state, setState] = useState<AppState | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("profile");
  const [toast, setToast] = useState<{ text: string; isError?: boolean } | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  const notify = useCallback((text: string, isError = false) => {
    setToast({ text, isError });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const fetchState = useCallback(async (uid = viewerId) => {
    const res = await fetch(`/api/state?userId=${encodeURIComponent(uid)}`);
    if (res.ok) {
      const data: AppState = await res.json();
      setState(data);
      setRefreshSignal((s) => s + 1);
    }
  }, [viewerId]);

  useEffect(() => {
    fetchState(viewerId);
  }, [viewerId, fetchState]);

  const callApi = async (url: string, body: unknown, method = "POST"): Promise<boolean> => {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-user-id": viewerId,
      },
      body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error || "تعذر تنفيذ العملية.", true);
      return false;
    }
    if (data.message) notify(data.message);
    await fetchState(viewerId);
    return true;
  };

  if (!state || !state.user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#101426] text-slate-300">
        جارٍ تشغيل نظام Study Bot...
      </div>
    );
  }

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
    { id: "profile", label: "البطاقة", icon: <User className="h-4 w-4" /> },
    { id: "focus", label: "الدراسة", icon: <Timer className="h-4 w-4" /> },
    { id: "challenges", label: "التحديات", icon: <Swords className="h-4 w-4" /> },
    { id: "economy", label: "البنك والقروض", icon: <Wallet className="h-4 w-4" /> },
    { id: "shop", label: "المتجر والمخزون", icon: <ShoppingBag className="h-4 w-4" /> },
    { id: "guilds", label: "النقابات", icon: <Shield className="h-4 w-4" /> },
    { id: "stats", label: "الإحصاءات", icon: <BarChart3 className="h-4 w-4" /> },
    { id: "entertainment", label: "الترفيه", icon: <Film className="h-4 w-4" /> },
    { id: "admin", label: "الدليل والإدارة", icon: <BookOpen className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen bg-[#101426] text-white">
      <header className="sticky top-0 z-30 border-b border-[#35446D]/60 bg-[#101426]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#5865F2] text-xl shadow-lg">
              📚
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight text-white">Study Bot</h1>
              <p className="text-xs text-slate-400">منظومة الدراسة والتحديات والاقتصاد</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs font-bold">
            {/* Switch active player account */}
            <label htmlFor="active-account-select" className="sr-only">
              تبديل الحساب النشط
            </label>
            <select
              id="active-account-select"
              value={viewerId}
              onChange={(e) => setViewerId(e.target.value)}
              className="rounded-xl border border-[#35446D] bg-[#191F38] px-3 py-2 text-xs font-bold text-slate-200 outline-none focus:border-[#568BFF]"
            >
              {state.allUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} {u.isAdmin ? "(إدارة)" : ""} {!u.registered ? "(غير مسجل)" : ""}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1.5 rounded-xl border border-[#35446D] bg-[#191F38] px-3 py-2 text-[#FFD166]">
              <Coins className="h-4 w-4" />
              <span>{state.user.coins.toLocaleString()}</span>
            </div>
            <div className="rounded-xl border border-[#35446D] bg-[#191F38] px-3 py-2 text-[#8DE0B2]">
              ⭐ Lv.{state.user.level}
            </div>
            <div className="rounded-xl border border-[#35446D] bg-[#191F38] px-3 py-2 text-orange-300">
              🔥 {state.user.streak}ي
            </div>
          </div>
        </div>

        {state.user.registered && (
          <div className="mx-auto max-w-7xl overflow-x-auto px-4 pb-3 sm:px-6">
            <nav className="flex gap-2">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition sm:text-sm ${
                    activeTab === t.id
                      ? "bg-[#5865F2] text-white shadow-md"
                      : "bg-[#191F38] text-slate-300 hover:bg-[#232b4d] hover:text-white"
                  }`}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
        )}
      </header>

      {toast && (
        <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
          <div
            className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-sm font-semibold whitespace-pre-line ${
              toast.isError
                ? "border-rose-500/50 bg-rose-950/60 text-rose-200"
                : "border-emerald-500/50 bg-emerald-950/60 text-emerald-200"
            }`}
          >
            <span>{toast.text}</span>
            <button onClick={() => setToast(null)} className="mr-4 text-xs opacity-75 hover:opacity-100">
              إغلاق
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {!state.user.registered ? (
          <RegistrationView
            defaultName={state.user.name}
            onRegister={async (input) => {
              await callApi("/api/register", input);
            }}
          />
        ) : (
          <>
            {activeTab === "profile" && (
              <ProfileCard
                user={state.user}
                products={state.products}
                onSaveBio={async (bio) => {
                  await callApi("/api/profile/bio", { bio });
                }}
                onSaveName={async (name) => {
                  await callApi("/api/user/name", { name });
                }}
              />
            )}

            {activeTab === "focus" && (
              <FocusPanel
                rooms={state.rooms}
                activeSession={state.activeStudySession}
                engagement={state.user.engagement}
                onAction={callApi}
              />
            )}

            {activeTab === "challenges" && (
              <ChallengesPanel state={state} onAction={callApi} />
            )}

            {activeTab === "economy" && (
              <EconomyPanel state={state} onAction={callApi} />
            )}

            {activeTab === "shop" && (
              <ShopPanel
                user={state.user}
                products={state.products}
                onBuy={async (productId, variant) => {
                  await callApi("/api/shop/buy", {
                    productId,
                    variant,
                    idempotencyKey: `ui-buy-${state.user.id}-${productId}-${variant}-${Date.now()}`,
                  });
                }}
                onUnequip={async (kind) => {
                  await callApi("/api/profile/unequip", { kind });
                }}
                onRequestCustomBg={async (idea) => {
                  await callApi("/api/profile/custom-bg", { idea });
                }}
              />
            )}

            {activeTab === "guilds" && (
              <GuildsPanel state={state} onAction={callApi} />
            )}

            {activeTab === "stats" && (
              <StatsLeaderboardPanel userId={state.user.id} refreshSignal={refreshSignal} />
            )}

            {activeTab === "entertainment" && <EntertainmentPanel />}

            {activeTab === "admin" && (
              <AdminHelpPanel
                state={state}
                onAction={callApi}
                onPing={async () => {
                  const r = await fetch("/api/ping").then((x) => x.json());
                  notify(r.message);
                }}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default App;
