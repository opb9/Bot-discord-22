import React, { useState } from "react";
import { BookOpen, Film, Lightbulb, MessageSquareQuote, Shuffle } from "lucide-react";
import { BOOKS, MOTIVATIONAL_QUOTES, MOVIES, NOVELS, TIPS } from "../data/botData";

type EntKind = "movie" | "book" | "novel" | "quote" | "tip";

export const EntertainmentPanel: React.FC = () => {
  const [movie, setMovie] = useState(() => MOVIES[0]);
  const [book, setBook] = useState(() => BOOKS[0]);
  const [novel, setNovel] = useState(() => NOVELS[0]);
  const [quote, setQuote] = useState(() => MOTIVATIONAL_QUOTES[0]);
  const [tip, setTip] = useState(() => TIPS[0]);

  const pickRandom = (kind: EntKind) => {
    if (kind === "movie") setMovie(MOVIES[Math.floor(Math.random() * MOVIES.length)]);
    if (kind === "book") setBook(BOOKS[Math.floor(Math.random() * BOOKS.length)]);
    if (kind === "novel") setNovel(NOVELS[Math.floor(Math.random() * NOVELS.length)]);
    if (kind === "quote")
      setQuote(MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)]);
    if (kind === "tip") setTip(TIPS[Math.floor(Math.random() * TIPS.length)]);
  };

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {/* /movie */}
      <div className="flex flex-col justify-between rounded-2xl border-r-4 border-[#5865F2] bg-[#191F38] p-5 shadow-lg">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-bold text-[#79A9FF]">
              <Film className="h-4 w-4" /> /movie — اقتراح فيلم
            </span>
            <button
              onClick={() => pickRandom("movie")}
              className="flex items-center gap-1 rounded-lg bg-[#101426] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#303954]"
            >
              <Shuffle className="h-3.5 w-3.5" /> اقتراح آخر
            </button>
          </div>
          <h3 className="text-xl font-extrabold text-white">
            🎬 {movie[0]} ({movie[1]})
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{movie[2]}</p>
        </div>
        <div className="mt-4 text-xs text-slate-500">فيلم نظيف ومناسب للعائلة</div>
      </div>

      {/* /book */}
      <div className="flex flex-col justify-between rounded-2xl border-r-4 border-[#00ACC1] bg-[#191F38] p-5 shadow-lg">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-bold text-cyan-300">
              <BookOpen className="h-4 w-4" /> /book — كتاب تطوير وثقافة
            </span>
            <button
              onClick={() => pickRandom("book")}
              className="flex items-center gap-1 rounded-lg bg-[#101426] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#303954]"
            >
              <Shuffle className="h-3.5 w-3.5" /> اقتراح آخر
            </button>
          </div>
          <h3 className="text-xl font-extrabold text-white">📖 {book[0]}</h3>
          <div className="mt-1 text-xs font-semibold text-cyan-200">✍️ {book[1]}</div>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{book[2]}</p>
        </div>
      </div>

      {/* /novel */}
      <div className="flex flex-col justify-between rounded-2xl border-r-4 border-[#6D28D9] bg-[#191F38] p-5 shadow-lg">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-bold text-purple-300">
              <BookOpen className="h-4 w-4" /> /novel — رواية عشوائية
            </span>
            <button
              onClick={() => pickRandom("novel")}
              className="flex items-center gap-1 rounded-lg bg-[#101426] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#303954]"
            >
              <Shuffle className="h-3.5 w-3.5" /> اقتراح آخر
            </button>
          </div>
          <h3 className="text-xl font-extrabold text-white">📚 {novel[0]}</h3>
          <div className="mt-1 text-xs font-semibold text-purple-200">✍️ {novel[1]}</div>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{novel[2]}</p>
        </div>
      </div>

      {/* /quote & /tip */}
      <div className="space-y-5">
        <div className="rounded-2xl border-r-4 border-[#F59E0B] bg-[#191F38] p-5 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-bold text-amber-300">
              <MessageSquareQuote className="h-4 w-4" /> /quote — اقتباس تحفيزي
            </span>
            <button
              onClick={() => pickRandom("quote")}
              className="flex items-center gap-1 rounded-lg bg-[#101426] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#303954]"
            >
              <Shuffle className="h-3.5 w-3.5" /> آخر
            </button>
          </div>
          <p className="text-base font-bold leading-relaxed text-white">«{quote}»</p>
        </div>

        <div className="rounded-2xl border-r-4 border-emerald-500 bg-[#191F38] p-5 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-bold text-emerald-300">
              <Lightbulb className="h-4 w-4" /> /tip — نصيحة دراسة
            </span>
            <button
              onClick={() => pickRandom("tip")}
              className="flex items-center gap-1 rounded-lg bg-[#101426] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#303954]"
            >
              <Shuffle className="h-3.5 w-3.5" /> أخرى
            </button>
          </div>
          <p className="text-sm leading-relaxed text-slate-200">💡 {tip}</p>
        </div>
      </div>
    </div>
  );
};
