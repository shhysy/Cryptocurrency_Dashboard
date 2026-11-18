import type { ExecutionFill } from "./types";

export type PositionSellKind =
  | "take_profit"
  | "indicator_profit"
  | "trail_stop"
  | "base_reduce";

export interface PositionLedgerSnapshot {
  baseQty: number;
  cycleQty: number;
  totalQty: number;
  costBasisUsdt: number;
  averageCostUsdt: number | null;
  realizedPnlUsdt: number;
  realizedSellCount: number;
}

const EPSILON = 1e-8;

/**
 * Replay exchange-confirmed fills using weighted-average cost.
 *
 * V3.3 allocates each net BUY quantity proportionally to its configured
 * long-term base ratio and cycle ratio. Ordinary profit/trailing sells can
 * consume cycle inventory only; base_reduce can consume protected base only.
 *
 * Base-asset BUY fees reduce acquired net quantity (not quote cost twice).
 * Base-asset SELL fees increase disposed inventory quantity (not proceeds
 * reduced twice). Quote/third-asset fees are applied to quote cost/proceeds.
 */
export function replayPositionLedger(
  fills: Array<ExecutionFill & { sellKind?: string; baseRatioAtBuy?: number }>,
  quoteAsset = "USDT",
): PositionLedgerSnapshot {
  if (!/^[A-Z0-9]{2,20}$/.test(quoteAsset)) throw new Error("报价资产格式无效");

  const sorted = [...fills].sort((a, b) =>
    a.time - b.time || a.orderId.localeCompare(b.orderId) || a.fillId.localeCompare(b.fillId)
  );
  let baseQty = 0;
  let cycleQty = 0;
  let costBasisUsdt = 0;
  let realizedPnlUsdt = 0;
  let realizedSellCount = 0;

  for (const fill of sorted) {
    if (!fill.symbol || !fill.fillId ||
        ![fill.time, fill.price, fill.qty, fill.quoteQty, fill.commission, fill.commissionUsdt].every(Number.isFinite) ||
        fill.time < 0 || fill.price <= 0 || fill.qty <= 0 || fill.quoteQty < 0 ||
        fill.commission < 0 || fill.commissionUsdt < 0) {
      throw new Error("成交台账存在无效字段");
    }
    const baseAsset = fill.symbol.endsWith(quoteAsset)
      ? fill.symbol.slice(0, -quoteAsset.length)
      : "";
    if (!baseAsset) throw new Error("成交交易对与报价资产不匹配");
    const feeInBase = fill.commissionAsset === baseAsset;

    if (fill.side === "BUY") {
      const baseRatioAtBuy = fill.baseRatioAtBuy;
      if (!Number.isFinite(baseRatioAtBuy) || (baseRatioAtBuy as number) < 0 || (baseRatioAtBuy as number) > 1) {
        throw new Error("买入成交缺少有效的历史底仓比例，禁止使用当前策略参数覆盖历史记录");
      }
      const netQty = fill.qty - (feeInBase ? fill.commission : 0);
      if (netQty <= EPSILON) throw new Error("买入基础币手续费已达到或超过成交数量");
      const quoteCost = fill.quoteQty + (feeInBase ? 0 : fill.commissionUsdt);
      if (!Number.isFinite(quoteCost) || quoteCost < 0) throw new Error("买入成本金额无效");
      baseQty += netQty * (baseRatioAtBuy as number);
      cycleQty += netQty * (1 - (baseRatioAtBuy as number));
      costBasisUsdt += quoteCost;
      continue;
    }

    if (fill.side !== "SELL") throw new Error("未知成交方向");
    const kind = fill.sellKind as PositionSellKind | undefined;
    if (!kind || !["take_profit", "indicator_profit", "trail_stop", "base_reduce"].includes(kind)) {
      throw new Error("卖出成交缺少有效卖出事件类型，不能确定应扣减周期仓还是底仓");
    }
    const disposedQty = fill.qty + (feeInBase ? fill.commission : 0);
    const proceeds = fill.quoteQty - (feeInBase ? 0 : fill.commissionUsdt);
    if (proceeds < -EPSILON) throw new Error("卖出净收入小于零");
    const bucketQty = kind === "base_reduce" ? baseQty : cycleQty;
    if (disposedQty > bucketQty + EPSILON) {
      throw new Error(kind === "base_reduce"
        ? "卖出数量超过可用长期底仓，暂停更新持仓账本"
        : "普通卖出数量超过可用周期仓，暂停更新持仓账本");
    }
    const totalQty = baseQty + cycleQty;
    if (totalQty <= EPSILON || costBasisUsdt < 0) throw new Error("卖出时持仓成本账本无效");
    const averageCost = costBasisUsdt / totalQty;
    const removedCost = averageCost * disposedQty;
    if (kind === "base_reduce") baseQty = Math.max(0, baseQty - disposedQty);
    else cycleQty = Math.max(0, cycleQty - disposedQty);
    costBasisUsdt = Math.max(0, costBasisUsdt - removedCost);
    realizedPnlUsdt += proceeds - removedCost;
    realizedSellCount += 1;
  }

  const totalQty = baseQty + cycleQty;
  if (totalQty <= EPSILON) {
    baseQty = 0;
    cycleQty = 0;
    costBasisUsdt = 0;
  }
  return {
    baseQty,
    cycleQty,
    totalQty: baseQty + cycleQty,
    costBasisUsdt,
    averageCostUsdt: baseQty + cycleQty > EPSILON ? costBasisUsdt / (baseQty + cycleQty) : null,
    realizedPnlUsdt,
    realizedSellCount,
  };
}
export interface ExchangePositionBalance {
  freeQty: number;
  lockedQty: number;
  totalQty: number;
}

/** Require the local confirmed-fill ledger to match Binance total holdings. */
export function assertPositionMatchesExchange(
  position: PositionLedgerSnapshot,
  exchange: ExchangePositionBalance,
): { freeBaseQty: number; totalPositionQty: number; protectedBaseQty: number } {
  if (![exchange.freeQty, exchange.lockedQty, exchange.totalQty].every(Number.isFinite) ||
      exchange.freeQty < 0 || exchange.lockedQty < 0 || exchange.totalQty < 0 ||
      Math.abs(exchange.freeQty + exchange.lockedQty - exchange.totalQty) > Math.max(EPSILON, exchange.totalQty * EPSILON)) {
    throw new Error("Binance free/locked 持仓余额字段无效");
  }
  const tolerance = Math.max(EPSILON, exchange.totalQty * EPSILON);
  if (Math.abs(position.totalQty - exchange.totalQty) > tolerance) {
    throw new Error(
      `本地成交台账数量 ${position.totalQty} 与 Binance 总持仓 ${exchange.totalQty} 不一致，暂停卖出预检`,
    );
  }
  if (position.baseQty > exchange.totalQty + tolerance) {
    throw new Error("本地受保护底仓数量超过 Binance 总持仓，暂停卖出预检");
  }
  return {
    freeBaseQty: exchange.freeQty,
    totalPositionQty: exchange.totalQty,
    protectedBaseQty: position.baseQty,
  };
}

export type PositionReconciliationStatus =
  | "matched"
  | "exchange_higher"
  | "ledger_higher"
  | "exchange_components_invalid";

export interface PositionReconciliationReport {
  status: PositionReconciliationStatus;
  ledgerQty: number;
  exchangeFreeQty: number;
  exchangeLockedQty: number;
  exchangeTotalQty: number;
  deltaQty: number;
  toleranceQty: number;
  canSell: boolean;
  explanation: string;
}

/**
 * Produce an audit-friendly quantity comparison. This report never adjusts
 * either source and is informational only; sell preflight must still call
 * assertPositionMatchesExchange and fail closed on every mismatch.
 */
export function buildPositionReconciliationReport(
  position: PositionLedgerSnapshot,
  exchange: ExchangePositionBalance,
): PositionReconciliationReport {
  const values = [position.totalQty, exchange.freeQty, exchange.lockedQty, exchange.totalQty];
  if (!values.every(Number.isFinite) ||
      position.totalQty < 0 || exchange.freeQty < 0 ||
      exchange.lockedQty < 0 || exchange.totalQty < 0) {
    throw new Error("持仓对账报告输入包含无效数量");
  }
  const toleranceQty = Math.max(EPSILON, exchange.totalQty * EPSILON);
  const componentsMatch = Math.abs(
    exchange.freeQty + exchange.lockedQty - exchange.totalQty,
  ) <= toleranceQty;
  const deltaQty = exchange.totalQty - position.totalQty;
  let status: PositionReconciliationStatus;
  let explanation: string;
  if (!componentsMatch) {
    status = "exchange_components_invalid";
    explanation = "Binance free + locked 与 total 不一致；暂停卖出并检查账户快照";
  } else if (Math.abs(deltaQty) <= toleranceQty) {
    status = "matched";
    explanation = "本地成交台账与 Binance 总持仓数量一致";
  } else if (deltaQty > 0) {
    status = "exchange_higher";
    explanation = "Binance 持仓多于本地成交台账；可能存在转入、漏同步成交或其他账户操作";
  } else {
    status = "ledger_higher";
    explanation = "本地成交台账多于 Binance 持仓；可能存在转出、手动卖出或未同步的账户变化";
  }
  return {
    status,
    ledgerQty: position.totalQty,
    exchangeFreeQty: exchange.freeQty,
    exchangeLockedQty: exchange.lockedQty,
    exchangeTotalQty: exchange.totalQty,
    deltaQty,
    toleranceQty,
    canSell: status === "matched",
    explanation,
  };
}

