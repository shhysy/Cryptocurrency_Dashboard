import { writeFile } from "node:fs/promises";
import { openLocalExecutionStore } from "./sqlite-store";
import { runTraderCycle } from "./trader-loop";

const NOW = 1_800_000_000_000;
const [, , phase, dbPath, markerPath, resultPath] = process.argv;
if (!dbPath || !markerPath || !resultPath) throw new Error("子进程测试参数缺失");

const store = await openLocalExecutionStore({ path: dbPath });
try {
  if (phase === "prepare") {
    const value = {
      intentId: "v33:BTC:head:1800000000000",
      strategyEventId: "BTC:head:1800000000000",
      strategyVersion: "3.3" as const,
      symbol: "BTCUSDT",
      side: "BUY" as const,
      quoteAsset: "USDT" as const,
      amount: "25",
      baseRatioAtSignal: 0.4,
      state: "queued" as const,
      attempt: 0,
      createdAt: NOW,
      updatedAt: NOW,
      exchangeOrderId: null,
      clientOrderId: null,
      exchangeTerminalAt: null,
      fillsReconciledAt: null,
      lastError: null,
    };
    await store.createIntent(value);
    const claim = await store.claimIntent({
      intentId: value.intentId,
      availableAsset: "USDT",
      availableAmount: "100",
      snapshotAt: NOW,
      now: NOW,
      leaseMs: 30_000,
    });
    if (!claim) throw new Error("测试BUY intent领取失败");
    const clientOrderId = claim.intent.clientOrderId;
    if (!clientOrderId) throw new Error("测试未生成clientOrderId");
    await store.markSubmitting({
      intentId: value.intentId,
      attempt: claim.lease.attempt,
      leaseToken: claim.lease.token,
      clientOrderId,
      now: NOW + 1,
    });
    await store.markUnknown({
      intentId: value.intentId,
      attempt: claim.lease.attempt,
      leaseToken: claim.lease.token,
      reason: "子进程SIGKILL演练：模拟POST后响应未知",
      now: NOW + 2,
    });
    await writeFile(markerPath, JSON.stringify({ clientOrderId }));
    // 保持SQLite连接和进程存活，等待父进程执行SIGKILL。
    await new Promise<void>(() => undefined);
  } else if (phase === "recover") {
    const marker = JSON.parse(await (await import("node:fs/promises")).readFile(markerPath, "utf8")) as {
      clientOrderId: string;
    };
    const lookups: Array<{ symbol: string; clientOrderId: string }> = [];
    let postCalls = 0;
    const result = await runTraderCycle({
      mode: "off",
      store,
      getDashboard: async () => { throw new Error("off模式不得读取新信号"); },
      adapter: {
        findOrderByClientOrderId: async (symbol: string, clientOrderId: string) => {
          lookups.push({ symbol, clientOrderId });
          return { kind: "not_found" as const };
        },
        listOrderTrades: async () => ({ trades: [], complete: true, pagesRead: 1 }),
        getAccountBalances: async () => [],
        getSymbolRules: async () => { throw new Error("not used"); },
      } as never,
      submitOrder: async () => {
        postCalls += 1;
        throw new Error("测试失败：恢复路径不允许再次POST");
      },
      now: () => NOW + 5_001,
    });
    const recovered = await store.getIntent("v33:BTC:head:1800000000000");
    await writeFile(resultPath, JSON.stringify({
      mode: result.mode,
      lookups,
      postCalls,
      state: recovered?.state ?? null,
      recoveredClientOrderId: recovered?.clientOrderId ?? null,
      expectedClientOrderId: marker.clientOrderId,
    }));
  } else {
    throw new Error("未知子进程测试阶段");
  }
} finally {
  if (phase !== "prepare") store.close();
}
