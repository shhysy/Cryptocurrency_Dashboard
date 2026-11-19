/**
 * 预备订单计划：第一笔头仓后，生成后续补仓/备用金 + 止盈档到 CSV。
 * - 未止盈：补仓锚定头仓价
 * - 出现过止盈：关闭原头仓锚定补仓，按当前均价生成回补；并重算止盈触发价
 * 本模块只生成计划与 CSV，不向交易所下单。
 */
import { strategyConfig, type Profile } from "@/strategy.config";

export type PrepSide = "BUY" | "SELL";
export type PrepKind = "add" | "reserve" | "replenish" | "takeProfit";
export type PrepStatus = "pending" | "cancelled" | "done";
export type PrepPhase = "initial" | "post_take_profit";

export interface PrepOrderRow {
  id: string;
  symbol: string;
  side: PrepSide;
  kind: PrepKind;
  label: string;
  tierIndex: number;
  /** BUY: 现价 ≤ 触发；SELL: 现价 ≥ 触发 */
  triggerPrice: number;
  triggerRule: string;
  plannedUsdt: number | null;
  /** 相对当时周期仓的卖出比例 */
  sellRatioOfCycle: number | null;
  status: PrepStatus;
  anchor: "head" | "avgCost";
  headPrice: number;
  avgCost: number;
  note: string;
  updatedAt: number;
}

export interface PrepPlan {
  symbol: string;
  group: "core" | "alt";
  phase: PrepPhase;
  headPrice: number;
  avgCost: number;
  baseRatio: number;
  hasTakenProfit: boolean;
  orders: PrepOrderRow[];
  generatedAt: number;
  strategyVersion: "V3.3-prep";
}

function profileOf(symbol: string): { group: "core" | "alt"; profile: Profile } {
  const group = strategyConfig.coreSymbols.includes(symbol) ? "core" : "alt";
  return { group, profile: strategyConfig.profiles[group] };
}

function roundPx(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 1000) return Math.round(n * 100) / 100;
  if (n >= 1) return Math.round(n * 10000) / 10000;
  return Math.round(n * 1e8) / 1e8;
}

function idOf(symbol: string, kind: string, tier: number, side: string): string {
  return `${symbol}:${side}:${kind}:${tier}`;
}

/** 头仓成交后：生成补仓1–4 + 备用金 + 止盈档（均价初始≈头仓价） */
export function buildInitialPrepPlan(input: {
  symbol: string;
  headPrice: number;
  avgCost?: number;
  now?: number;
}): PrepPlan {
  const now = input.now ?? Date.now();
  const headPrice = input.headPrice;
  const avgCost = input.avgCost && input.avgCost > 0 ? input.avgCost : headPrice;
  const { group, profile } = profileOf(input.symbol);
  const orders: PrepOrderRow[] = [];

  profile.adds.forEach((tier, i) => {
    const triggerPrice = roundPx(headPrice * (1 - tier.drop));
    orders.push({
      id: idOf(input.symbol, "add", i + 1, "BUY"),
      symbol: input.symbol,
      side: "BUY",
      kind: "add",
      label: `补仓${i + 1}`,
      tierIndex: i + 1,
      triggerPrice,
      triggerRule: `现价 ≤ 头仓价 × (1 - ${tier.drop})`,
      plannedUsdt: tier.usdt,
      sellRatioOfCycle: null,
      status: "pending",
      anchor: "head",
      headPrice,
      avgCost,
      note: `相对头仓价下跌 ${(tier.drop * 100).toFixed(0)}%`,
      updatedAt: now,
    });
  });

  const resTrigger = roundPx(headPrice * (1 - profile.reserve.drop));
  orders.push({
    id: idOf(input.symbol, "reserve", 1, "BUY"),
    symbol: input.symbol,
    side: "BUY",
    kind: "reserve",
    label: "备用金",
    tierIndex: profile.adds.length + 1,
    triggerPrice: resTrigger,
    triggerRule: `现价 ≤ 头仓价 × (1 - ${profile.reserve.drop})，且满足备用金额外条件`,
    plannedUsdt: profile.reserve.usdt,
    sellRatioOfCycle: null,
    status: "pending",
    anchor: "head",
    headPrice,
    avgCost,
    note: "4 档补仓用完后的备用金",
    updatedAt: now,
  });

  profile.takeProfit.forEach((tp, i) => {
    const triggerPrice = roundPx(avgCost * tp.mult);
    orders.push({
      id: idOf(input.symbol, "takeProfit", i + 1, "SELL"),
      symbol: input.symbol,
      side: "SELL",
      kind: "takeProfit",
      label: `止盈${i + 1}`,
      tierIndex: i + 1,
      triggerPrice,
      triggerRule: `现价 ≥ 均价 × ${tp.mult}`,
      plannedUsdt: null,
      sellRatioOfCycle: tp.ratio,
      status: "pending",
      anchor: "avgCost",
      headPrice,
      avgCost,
      note: `卖出当时周期仓的 ${(tp.ratio * 100).toFixed(0)}%`,
      updatedAt: now,
    });
  });

  return {
    symbol: input.symbol,
    group,
    phase: "initial",
    headPrice,
    avgCost,
    baseRatio: profile.baseRatio,
    hasTakenProfit: false,
    orders,
    generatedAt: now,
    strategyVersion: "V3.3-prep",
  };
}

/**
 * 出现止盈后：取消所有头仓锚定的补仓/备用金；
 * 按当前均价从第 1 档起生成回补；按新均价重生成全部止盈档。
 */
export function rebuildPrepPlanAfterTakeProfit(input: {
  symbol: string;
  headPrice: number;
  avgCost: number;
  completedTakeProfitTiers?: number[];
  now?: number;
}): PrepPlan {
  const now = input.now ?? Date.now();
  const { headPrice, avgCost } = input;
  const { group, profile } = profileOf(input.symbol);
  const doneTp = new Set(input.completedTakeProfitTiers ?? []);
  const orders: PrepOrderRow[] = [];

  profile.adds.forEach((tier, i) => {
    orders.push({
      id: idOf(input.symbol, "add", i + 1, "BUY"),
      symbol: input.symbol,
      side: "BUY",
      kind: "add",
      label: `补仓${i + 1}`,
      tierIndex: i + 1,
      triggerPrice: roundPx(headPrice * (1 - tier.drop)),
      triggerRule: "已关闭：出现止盈后不再按头仓价补仓",
      plannedUsdt: tier.usdt,
      sellRatioOfCycle: null,
      status: "cancelled",
      anchor: "head",
      headPrice,
      avgCost,
      note: "止盈后关闭",
      updatedAt: now,
    });
  });
  orders.push({
    id: idOf(input.symbol, "reserve", 1, "BUY"),
    symbol: input.symbol,
    side: "BUY",
    kind: "reserve",
    label: "备用金",
    tierIndex: profile.adds.length + 1,
    triggerPrice: roundPx(headPrice * (1 - profile.reserve.drop)),
    triggerRule: "已关闭：出现止盈后不再按头仓价备用金",
    plannedUsdt: profile.reserve.usdt,
    sellRatioOfCycle: null,
    status: "cancelled",
    anchor: "head",
    headPrice,
    avgCost,
    note: "止盈后关闭",
    updatedAt: now,
  });

  profile.adds.forEach((tier, i) => {
    const triggerPrice = roundPx(avgCost * (1 - tier.drop));
    orders.push({
      id: idOf(input.symbol, "replenish", i + 1, "BUY"),
      symbol: input.symbol,
      side: "BUY",
      kind: "replenish",
      label: `回补${i + 1}`,
      tierIndex: i + 1,
      triggerPrice,
      triggerRule: `现价 ≤ 均价 × (1 - ${tier.drop})`,
      plannedUsdt: tier.usdt,
      sellRatioOfCycle: null,
      status: "pending",
      anchor: "avgCost",
      headPrice,
      avgCost,
      note: `止盈后回补：相对均价下跌 ${(tier.drop * 100).toFixed(0)}%`,
      updatedAt: now,
    });
  });

  profile.takeProfit.forEach((tp, i) => {
    const tier = i + 1;
    const triggerPrice = roundPx(avgCost * tp.mult);
    orders.push({
      id: idOf(input.symbol, "takeProfit", tier, "SELL"),
      symbol: input.symbol,
      side: "SELL",
      kind: "takeProfit",
      label: `止盈${tier}`,
      tierIndex: tier,
      triggerPrice,
      triggerRule: `现价 ≥ 均价 × ${tp.mult}`,
      plannedUsdt: null,
      sellRatioOfCycle: tp.ratio,
      status: doneTp.has(tier) ? "done" : "pending",
      anchor: "avgCost",
      headPrice,
      avgCost,
      note: doneTp.has(tier)
        ? "本档已执行"
        : `卖出当时周期仓的 ${(tp.ratio * 100).toFixed(0)}%；均价更新后重算`,
      updatedAt: now,
    });
  });

  return {
    symbol: input.symbol,
    group,
    phase: "post_take_profit",
    headPrice,
    avgCost,
    baseRatio: profile.baseRatio,
    hasTakenProfit: true,
    orders,
    generatedAt: now,
    strategyVersion: "V3.3-prep",
  };
}

/** 回补成交导致均价变化后：按新均价重算未完成止盈与 pending 回补触发价 */
export function refreshTakeProfitsAfterReplenish(
  plan: PrepPlan,
  newAvgCost: number,
  now = Date.now(),
): PrepPlan {
  const avgCost = newAvgCost;
  const { profile } = profileOf(plan.symbol);
  const orders = plan.orders.map((row) => {
    if (row.kind !== "takeProfit" || row.status === "done" || row.status === "cancelled") {
      return { ...row, avgCost, updatedAt: now };
    }
    const tp = profile.takeProfit[row.tierIndex - 1];
    if (!tp) return { ...row, avgCost, updatedAt: now };
    return {
      ...row,
      triggerPrice: roundPx(avgCost * tp.mult),
      avgCost,
      triggerRule: `现价 ≥ 均价 × ${tp.mult}`,
      note: `回补后均价更新，止盈触发价已重算`,
      updatedAt: now,
    };
  });
  const refreshed = orders.map((row) => {
    if (row.kind !== "replenish" || row.status !== "pending") return row;
    const tier = profile.adds[row.tierIndex - 1];
    if (!tier) return row;
    return {
      ...row,
      triggerPrice: roundPx(avgCost * (1 - tier.drop)),
      avgCost,
      updatedAt: now,
    };
  });
  return {
    ...plan,
    avgCost,
    orders: refreshed,
    generatedAt: now,
  };
}

export function pendingPrepOrders(plan: PrepPlan): PrepOrderRow[] {
  return plan.orders.filter((o) => o.status === "pending");
}
