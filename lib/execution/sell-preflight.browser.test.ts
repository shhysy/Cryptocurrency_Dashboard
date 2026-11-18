import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSellPositionSnapshotFromBinance } from "./position-accounting.browser";
import { prepareQueuedSellDryRunFromBinance } from "./sell-preflight.browser";
import type { MarketRules } from "./binance-preflight";
import type { SellEventRecord } from "./sell-store.browser";

vi.mock("./position-accounting.browser", () => ({
  getSellPositionSnapshotFromBinance: vi.fn(),
}));

const rules: MarketRules = {
  symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT",
  stepSize: 0.001, minQty: 0.001, maxQty: 100, minNotional: 5,
  maxNotional: 100000, quotePrecision: 8, quoteOrderQtyMarketAllowed: true,
};
const event: SellEventRecord = {
  eventKey: "sell:BTC:take_profit:week-1", symbol: "BTC", kind: "take_profit",
  status: "pending", requestedQty: 0.02, createdAt: 1, updatedAt: 1,
  exchangeOrderId: null, fillIds: [], lastError: null,
};

const getPosition = vi.mocked(getSellPositionSnapshotFromBinance);

describe("balance-reconciled sell dry-run preflight", () => {
  beforeEach(() => vi.resetAllMocks());

  it("uses the ledger-protected base and current Binance free quantity", async () => {
    getPosition.mockResolvedValue({
      symbol: "BTC", pair: "BTCUSDT", fillCount: 2,
      baseQty: 0.04, cycleQty: 0.06, totalQty: 0.1,
      costBasisUsdt: 5000, averageCostUsdt: 50000,
      realizedPnlUsdt: 0, realizedSellCount: 0,
      freeBaseQty: 0.08, totalPositionQty: 0.1, protectedBaseQty: 0.04,
    });
    const result = await prepareQueuedSellDryRunFromBinance({
      event, rules, currentPrice: 50000,
    });
    expect(result).toMatchObject({ submitted: false, ok: true, executableQty: 0.02 });
    expect(getPosition).toHaveBeenCalledWith("BTC", "USDT");
  });

  it("stops before preflight when the local ledger and Binance balance disagree", async () => {
    getPosition.mockRejectedValue(new Error("本地成交台账数量与 Binance 总持仓不一致"));
    await expect(prepareQueuedSellDryRunFromBinance({
      event, rules, currentPrice: 50000,
    })).rejects.toThrow("不一致");
  });
});
