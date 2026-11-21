import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serverExecutionIntentId, type ServerExecutionIntent } from "../server-execution-core";
import { openLocalExecutionStore } from "./sqlite-store";

const NOW = 1_800_000_000_000;
const directories: string[] = [];

async function tempDbPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cryptodash-concurrent-"));
  directories.push(directory);
  return join(directory, "data", "trader.db");
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

function buyIntent(): ServerExecutionIntent {
  const eventId = "BTC:head:2026W47-concurrent";
  return {
    intentId: serverExecutionIntentId(eventId),
    strategyEventId: eventId,
    strategyVersion: "3.3",
    strategyTier: "head",
    symbol: "BTCUSDT",
    side: "BUY",
    quoteAsset: "USDT",
    amount: "10",
    baseRatioAtSignal: 0.4,
    state: "queued",
    attempt: 0,
    createdAt: NOW,
    updatedAt: NOW,
    exchangeOrderId: null,
    clientOrderId: null,
    exchangeTerminalAt: null,
    fillsReconciledAt: null,
    lastError: null,
  };
}

describe("SQLite 双连接并发", () => {
  it("双独立连接竞争 claim：同一 intent 仅一个成功", async () => {
    const path = await tempDbPath();
    const a = await openLocalExecutionStore({ path });
    const b = await openLocalExecutionStore({ path });
    try {
      const value = buyIntent();
      await a.createIntent(value);
      const claimInput = {
        intentId: value.intentId,
        availableAsset: "USDT",
        availableAmount: "100",
        snapshotAt: NOW,
        now: NOW,
        leaseMs: 30_000,
      };
      const [r1, r2] = await Promise.all([
        a.claimIntent(claimInput).catch((e: unknown) => e),
        b.claimIntent({ ...claimInput, now: NOW + 1 }).catch((e: unknown) => e),
      ]);
      const ok = [r1, r2].filter((x) => x && typeof x === "object" && !(x instanceof Error) && x !== null);
      expect(ok.length).toBe(1);
      const failed = [r1, r2].filter((x) => x == null || x instanceof Error);
      expect(failed.length).toBe(1);
    } finally {
      a.close();
      b.close();
    }
  });

  it("双独立SQLite连接竞争同一成交Outbox，只允许一个领取者并可围栏确认", async () => {
    const path = await tempDbPath();
    const a = await openLocalExecutionStore({ path });
    const b = await openLocalExecutionStore({ path });
    try {
      await a.tradeLedger.recordConfirmedSellFill({
        fillId: "outbox-fill-1",
        orderId: "9001",
        symbol: "BTCUSDT",
        side: "SELL",
        time: NOW,
        price: 100,
        qty: 0.1,
        quoteQty: 10,
        commission: 0,
        commissionAsset: "USDT",
        commissionUsdt: 0,
      }, "take_profit");

      const [left, right] = await Promise.all([
        a.notificationOutbox.claimDue({ now: NOW + 1, leaseMs: 30_000, limit: 10 }),
        b.notificationOutbox.claimDue({ now: NOW + 1, leaseMs: 30_000, limit: 10 }),
      ]);
      expect(left.length + right.length).toBe(1);
      const lease = left[0] ?? right[0]!;
      expect(lease.event.id).toBe("trade-fill:BTCUSDT:outbox-fill-1");
      expect(lease.event.status).toBe("sending");
      const owner = left.length ? a : b;
      const other = left.length ? b : a;
      expect(await other.notificationOutbox.claimDue({
        now: NOW + 2, leaseMs: 30_000, limit: 10,
      })).toHaveLength(0);
      expect(await owner.notificationOutbox.markSent({
        id: lease.event.id,
        leaseToken: lease.leaseToken,
        now: NOW + 3,
      })).toBe(true);
      expect(await owner.notificationOutbox.claimDue({
        now: NOW + 4, leaseMs: 30_000, limit: 10,
      })).toHaveLength(0);
    } finally {
      a.close();
      b.close();
    }
  });

});
