import { describe, expect, it, vi } from "vitest";
import { tradeLedgerToCsv, syncTradeLedgerCsv } from "./trade-ledger-csv";

const entry = {
  id: "ledger-1", fillId: "trade-123", orderId: "order-456", symbol: "BTCUSDT",
  side: "BUY" as const, time: 1_800_000_000_000, price: 100500, qty: 0.00099,
  quoteQty: 99.495, commission: 0.00000099, commissionAsset: "BTC",
  commissionUsdt: 0.099495, realizedPnlUsdt: null, sellKind: undefined, baseRatioAtBuy: 0.6,
};

describe("真实成交CSV", () => {
  it("只输出已确认成交字段，不输出待买订单或估算价格", () => {
    const csv = tradeLedgerToCsv([entry]);
    expect(csv).toContain("trade-123");
    expect(csv).toContain("BTCUSDT");
    expect(csv).toContain("99.495");
    expect(csv).not.toContain("plannedUsdt");
    expect(csv).not.toContain("referencePrice");
  });

  it("空台账仍输出表头", () => {
    expect(tradeLedgerToCsv([]).split("\\r\\n")[0]).toContain("fillId");
  });

  it("从SQLite台账读取并原子同步CSV", async () => {
    const listTradeLedger = vi.fn().mockResolvedValue([entry]);
    const store = { tradeLedger: { listTradeLedger } } as never;
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "trades-csv-"));
    try {
      const path = join(dir, "trades.csv");
      const result = await syncTradeLedgerCsv(store, path);
      expect(result.rows).toBe(1);
      expect(await readFile(path, "utf8")).toContain("trade-123");
      expect(listTradeLedger).toHaveBeenCalledOnce();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
