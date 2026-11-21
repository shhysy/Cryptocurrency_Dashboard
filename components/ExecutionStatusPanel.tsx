"use client";

import { useEffect, useState } from "react";

type Snapshot = {
  generatedAt: number;
  mode: string;
  stopRequested: boolean;
  trader: {
    state: "running" | "heartbeat_stale" | "stale_lock" | "stopped" | "invalid_lock";
    pid: number | null;
    startedAt: number | null;
    heartbeatAt: number | null;
  };
  database: {
    available: boolean;
    reason?: string;
    counts: {
      intents: number;
      buysOpen: number;
      sellsOpen: number;
      manualReview: number;
      reservations: number;
      notificationsPending: number;
      fills: number;
    };
    intents: Array<{ id: string; symbol: string; side: "BUY" | "SELL"; amount: string; state: string; updatedAt: number }>;
    sells: Array<{ eventKey: string; symbol: string; kind: string; status: string; requestedQty: number; filledQty: number | null; updatedAt: number }>;
    fills: Array<{ id: string; symbol: string; side: "BUY" | "SELL"; price: number; qty: number; quoteQty: number; time: number; realizedPnlUsdt: number | null }>;
    notificationStates: Record<string, number>;
  };
};

const number = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(value);
const time = (value: number | null) => value ? new Date(value).toLocaleString() : "—";

const stateLabels: Record<string, string> = {
  running: "运行中",
  heartbeat_stale: "心跳异常",
  stale_lock: "陈旧锁待检查",
  stopped: "未运行",
  invalid_lock: "锁文件异常",
  off: "关闭",
  "dry-run": "模拟",
  testnet: "Testnet",
  production: "生产（当前禁止启动）",
  unknown: "未知模式",
};

export default function ExecutionStatusPanel({ refreshKey }: { refreshKey: number }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/trader-status", { cache: "no-store" });
        const payload = await response.json() as Snapshot | { error?: string };
        if (!response.ok || !("database" in payload)) {
          throw new Error(("error" in payload && payload.error) || "本地Trader状态接口不可用");
        }
        if (!active) return;
        setSnapshot(payload);
        setUpdatedAt(Date.now());
        setError(null);
      } catch (cause) {
        if (!active) return;
        setSnapshot(null);
        setError(cause instanceof Error ? cause.message : "读取本地Trader状态失败");
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refreshKey]);

  if (error) {
    return (
      <section className="glass space-y-2 p-3">
        <h3 className="text-sm font-semibold text-fg">本地Trader执行状态</h3>
        <p className="text-xs text-warn">{error}</p>
        <p className="text-[10px] text-mute">此面板只读取本机Trader SQLite，不会回退到浏览器IndexedDB冒充真实执行状态。请确认本地状态接口已启用，并将Next.js绑定到127.0.0.1。</p>
      </section>
    );
  }

  if (!snapshot) {
    return <section className="glass p-3" aria-live="polite"><h3 className="text-sm font-semibold text-fg">本地Trader执行状态</h3><p className="mt-2 text-xs text-mute">正在读取本机SQLite状态…</p></section>;
  }

  const { database, trader } = snapshot;
  const running = trader.state === "running";
  const review = database.counts.manualReview;

  return (
    <section className="glass space-y-3 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">本地Trader执行状态</h3>
          <p className="mt-0.5 text-[10px] text-mute">数据来源：本机SQLite只读快照 · 最近读取 {time(updatedAt)}</p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${running ? "border-emerald-500/40 text-emerald-500" : "border-warn/40 text-warn"}`}>
          {stateLabels[trader.state] ?? trader.state}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="运行模式" value={stateLabels[snapshot.mode] ?? snapshot.mode} detail={snapshot.stopRequested ? "STOP已触发" : "STOP未触发"} warning={snapshot.stopRequested} />
        <Metric label="待买订单" value={database.counts.buysOpen} detail="SQLite中的未终态BUY" />
        <Metric label="待卖事件" value={database.counts.sellsOpen} detail="含待提交/待对账SELL" />
        <Metric label="人工复核" value={review} detail="需人工处理的执行记录" warning={review > 0} />
        <Metric label="资金预留" value={database.counts.reservations} detail="保留中的SQLite预留" />
        <Metric label="待处理通知" value={database.counts.notificationsPending} detail="Outbox待发/租约/复核" warning={database.counts.notificationsPending > 0} />
        <Metric label="累计成交" value={database.counts.fills} detail="SQLite成交台账记录" />
        <Metric label="Trader PID" value={trader.pid ?? "—"} detail={`心跳 ${time(trader.heartbeatAt)}`} />
      </div>
      {!database.available && <p className="text-xs text-warn">{database.reason ?? "Trader数据库不可用"}</p>}
      {database.available && (
        <>
          {review > 0 && <p className="rounded-lg border border-warn/40 bg-warn/5 p-2 text-xs text-warn">有 {review} 条执行记录需要人工复核；请先检查日志和交易所订单，不要直接删除数据库记录。</p>}
          <div className="space-y-1">
            <p className="text-xs font-medium text-fg">最近订单</p>
            {database.intents.slice(0, 6).map((item) => <p key={item.id} className="text-[10px] text-sub">{item.symbol} {item.side} · {item.amount} USDT · {item.state} · {time(item.updatedAt)}</p>)}
            {database.intents.length === 0 && <p className="text-[10px] text-mute">暂无订单意图</p>}
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-fg">最近卖出事件</p>
            {database.sells.slice(0, 5).map((item) => <p key={item.eventKey} className="text-[10px] text-sub">{item.symbol} {item.kind} · {item.status} · 成交 {number(item.filledQty ?? 0)} / {number(item.requestedQty)}</p>)}
            {database.sells.length === 0 && <p className="text-[10px] text-mute">暂无卖出事件</p>}
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-fg">最近成交</p>
            {database.fills.slice(0, 5).map((item) => <p key={item.id} className="text-[10px] text-sub">{item.symbol} {item.side} · {number(item.qty)} @ {number(item.price)} · {time(item.time)}</p>)}
            {database.fills.length === 0 && <p className="text-[10px] text-mute">暂无已确认成交</p>}
          </div>
        </>
      )}
      <p className="text-[10px] text-mute">只读看板不创建、取消或重试订单；Trader心跳、STOP、订单、成交及Outbox状态均来自本机SQLite/锁文件。接口默认关闭，禁止通过公网反向代理暴露。</p>
    </section>
  );
}

function Metric({ label, value, detail, warning = false }: { label: string; value: string | number; detail: string; warning?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-soft/40 p-2.5">
      <p className="text-[10px] text-mute">{label}</p>
      <p className={`num mt-1 text-lg font-semibold ${warning ? "text-warn" : "text-fg"}`}>{value}</p>
      <p className="mt-0.5 text-[10px] text-mute">{detail}</p>
    </div>
  );
}
