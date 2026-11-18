import { describe, expect, it, vi } from "vitest";
import {
  assertLiveOrderSubmissionDisabled,
  BINANCE_ORDER_MODE,
  LIVE_ORDER_SUBMISSION_ENABLED,
  prepareQueuedBuyDryRun,
} from "./binance-order.browser";
import type { QueuedBuyOrder } from "./types";
import type { BuyFundsReservation } from "./fund-reservation";
import type { SpotSymbolFilters } from "../binance.browser";

const order: QueuedBuyOrder = {
  id: "queue-btc-1",
  eventKey: "BTCUSDT|head|week-1",
  symbol: "BTCUSDT",
  quoteAsset: "USDT",
  strategyLabel: "头仓",
  plannedUsdt: 100,
  referencePrice: 50000,
  createdAt: 1,
  strategyVersion: "V3.3",
  status: "pending",
  filledUsdt: 0,
  remainingUsdt: 100,
  attemptCount: 0,
  lastAttemptAt: null,
  lastError: null,
  updatedAt: 1,
};

const filters: SpotSymbolFilters = {
  symbol: "BTCUSDT",
  status: "TRADING",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  basePrecision: 8,
  quotePrecision: 8,
  quoteOrderQtyMarketAllowed: true,
  filters: [
    { filterType: "MARKET_LOT_SIZE", minQty: "0.00001", maxQty: "900", stepSize: "0.00001" },
    { filterType: "NOTIONAL", minNotional: "5", maxNotional: "100000", applyToMarket: true },
  ],
};

describe("Binance buy execution adapter safety boundary", () => {
  it("always runs in DRY_RUN and never reports a submitted order", async () => {
    const result = await prepareQueuedBuyDryRun(order, 1000, {
      getFreeUsdt: vi.fn().mockResolvedValue(50),
      getSymbolFilters: vi.fn().mockResolvedValue(filters),
    });
    expect(result).toMatchObject({
      mode: BINANCE_ORDER_MODE,
      submitted: false,
      ok: true,
      executableUsdt: 50,
      remainingPlannedUsdt: 50,
    });
    expect(LIVE_ORDER_SUBMISSION_ENABLED).toBe(false);
  });


  it("adds the USDT quote asset when the queue stores a base-asset symbol", async () => {
    const getSymbolFilters = vi.fn().mockResolvedValue(filters);
    const result = await prepareQueuedBuyDryRun(
      { ...order, symbol: "BTC" },
      1000,
      { getFreeUsdt: vi.fn().mockResolvedValue(50), getSymbolFilters },
    );
    expect(getSymbolFilters).toHaveBeenCalledWith("BTCUSDT");
    expect(result.symbol).toBe("BTCUSDT");
  });


  it("subtracts other active USDT reservations before planning a partial buy", async () => {
    const otherReservation: BuyFundsReservation = {
      orderId: "queue-eth-2",
      symbol: "ETHUSDT",
      reservedUsdt: 40,
      originalReservedUsdt: 40,
      consumedUsdt: 0,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
      releaseReason: null,
    };
    const result = await prepareQueuedBuyDryRun(order, 1000, {
      getFreeUsdt: vi.fn().mockResolvedValue(100),
      getSymbolFilters: vi.fn().mockResolvedValue(filters),
      getReservations: vi.fn().mockResolvedValue([otherReservation]),
    });
    expect(result).toMatchObject({
      ok: true,
      freeUsdt: 100,
      otherReservedUsdt: 40,
      unreservedFreeUsdt: 60,
      proposedReserveUsdt: 60,
      executableUsdt: 60,
      remainingPlannedUsdt: 40,
    });
  });

  it("respects the remaining per-asset cost cap", async () => {
    const result = await prepareQueuedBuyDryRun(order, 30, {
      getFreeUsdt: vi.fn().mockResolvedValue(100),
      getSymbolFilters: vi.fn().mockResolvedValue(filters),
    });
    expect(result.executableUsdt).toBe(30);
    expect(result.remainingPlannedUsdt).toBe(70);
  });

  it("keeps an order queued when free USDT is below exchange minimum notional", async () => {
    const result = await prepareQueuedBuyDryRun(order, 1000, {
      getFreeUsdt: vi.fn().mockResolvedValue(4),
      getSymbolFilters: vi.fn().mockResolvedValue(filters),
    });
    expect(result).toMatchObject({ ok: false, executableUsdt: 0, remainingPlannedUsdt: 100 });
    expect(result.reason).toContain("最小名义金额");
  });

  it("rejects orders requiring reconciliation instead of preparing a new attempt", async () => {
    await expect(prepareQueuedBuyDryRun(
      { ...order, status: "reconcile_required" },
      1000,
      { getFreeUsdt: vi.fn(), getSymbolFilters: vi.fn() },
    )).rejects.toThrow("不允许进入买入预检");
  });

  it("fails closed if a caller attempts to enable live submission", () => {
    expect(() => assertLiveOrderSubmissionDisabled()).toThrow("实盘下单尚未启用");
  });
});
