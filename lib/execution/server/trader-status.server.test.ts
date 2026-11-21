import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openLocalExecutionStore } from "./sqlite-store";
import { readTraderStatusSnapshot } from "./trader-status.server";

const directories: string[] = [];
async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cryptodash-trader-status-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe("本地Trader只读状态快照", () => {
  it("数据库不存在时不创建空SQLite文件", async () => {
    const directory = await tempDirectory();
    const dbPath = join(directory, "missing", "trader.db");
    const snapshot = await readTraderStatusSnapshot({
      dbPath,
      lockPath: join(directory, "trader.lock"),
      stopPath: join(directory, "STOP"),
      mode: "testnet",
    });
    expect(snapshot.database.available).toBe(false);
    expect(snapshot.database.reason).toContain("尚未创建");
    await expect(stat(dbPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("只读展示真实SQLite订单与STOP/心跳，但绝不返回锁token", async () => {
    const directory = await tempDirectory();
    const dbPath = join(directory, "data", "trader.db");
    const lockPath = join(directory, "data", "trader.lock");
    const stopPath = join(directory, "data", "STOP");
    const store = await openLocalExecutionStore({ path: dbPath });
    try {
      await store.createIntent({
        intentId: "v33:BTC:head:1800000000000",
        strategyEventId: "BTC:head:1800000000000",
        strategyVersion: "3.3",
        symbol: "BTCUSDT",
        side: "BUY",
        quoteAsset: "USDT",
        amount: "25",
        baseRatioAtSignal: 0.4,
        state: "queued",
        attempt: 0,
        createdAt: 1_800_000_000_000,
        updatedAt: 1_800_000_000_000,
        exchangeOrderId: null,
        clientOrderId: null,
        exchangeTerminalAt: null,
        fillsReconciledAt: null,
        lastError: null,
      });
    } finally {
      store.close();
    }
    const secretLockToken = "do-not-expose-this-lock-token-123456";
    await writeFile(lockPath, JSON.stringify({
      pid: process.pid,
      token: secretLockToken,
      startedAt: Date.now() - 5_000,
      heartbeatAt: Date.now(),
    }));
    await writeFile(stopPath, "manual stop\n");

    const snapshot = await readTraderStatusSnapshot({
      dbPath, lockPath, stopPath, mode: "testnet",
    });
    expect(snapshot.mode).toBe("testnet");
    expect(snapshot.stopRequested).toBe(true);
    expect(snapshot.trader.state).toBe("running");
    expect(snapshot.trader.pid).toBe(process.pid);
    expect(snapshot.database.available).toBe(true);
    expect(snapshot.database.counts.intents).toBe(1);
    expect(snapshot.database.counts.buysOpen).toBe(1);
    expect(snapshot.database.intents[0]).toMatchObject({
      symbol: "BTCUSDT", side: "BUY", amount: "25", state: "queued",
    });
    expect(JSON.stringify(snapshot)).not.toContain(secretLockToken);

    // 只读查询不应改写数据库中的订单状态。
    const reopened = await openLocalExecutionStore({ path: dbPath });
    try {
      expect((await reopened.getIntent("v33:BTC:head:1800000000000"))?.state).toBe("queued");
    } finally {
      reopened.close();
    }
    expect(await readFile(stopPath, "utf8")).toContain("manual stop");
  });
});
