"use client";

import { useEffect, useRef, useState } from "react";
import type { DashboardData } from "@/lib/types";

const CN: Record<string, string> = {
  BTC: "比特币",
  ETH: "以太坊",
  BNB: "币安币",
  UNI: "Uniswap",
  PAXG: "黄金(PAXG)",
  CL: "原油(WTI)",
};

type ToastItem = { id: string; title: string; body: string };

const STORAGE_KEY = "score-toast-seen-v1";
const TTL_MS = 5_000;

function seenMap(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function markSeen(key: string) {
  const m = seenMap();
  m[key] = Date.now();
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(m));
}

function wasSeen(key: string) {
  return Boolean(seenMap()[key]);
}

export default function ScoreToast({ data }: { data: DashboardData }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const core = data.config?.mailScoreCore ?? 61;
    const alt = data.config?.mailScoreAlt ?? 83;
    const next: ToastItem[] = [];

    for (const c of data.coins) {
      const group = c.signal?.group || "alt";
      const min = group === "core" ? core : alt;
      const score = c.signal?.score ?? 0;
      if (score < min) continue;

      const key = `${c.symbol}:${score}`;
      if (wasSeen(key)) continue;
      markSeen(key);

      const name = CN[c.symbol] || c.name || c.symbol;
      const gLabel = group === "core" ? "核心" : "山寨";
      next.push({
        id: key,
        title: `${name} 达到 ${score} 分`,
        body: `${name}（${c.symbol}）机会指数 ${score}/100，已达${gLabel}门槛 ${min} 分`,
      });
    }

    if (!next.length) return;

    setItems((prev) => [...prev, ...next].slice(-6));

    for (const t of next) {
      const tid = window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
        timers.current.delete(t.id);
      }, TTL_MS);
      timers.current.set(t.id, tid);
    }
  }, [data.coins, data.config?.mailScoreCore, data.config?.mailScoreAlt, data.updatedAt]);

  useEffect(() => {
    return () => {
      for (const tid of timers.current.values()) window.clearTimeout(tid);
    };
  }, []);

  if (!items.length) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 top-16 z-[100] flex w-[min(100vw-2rem,320px)] flex-col gap-2"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto rounded-xl border border-gold/40 bg-pop px-4 py-3 shadow-lg fade-in"
          role="status"
        >
          <p className="text-sm font-semibold text-gold">{t.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-sub">{t.body}</p>
          <p className="mt-2 text-[10px] text-mute">5 秒后自动关闭</p>
        </div>
      ))}
    </div>
  );
}
