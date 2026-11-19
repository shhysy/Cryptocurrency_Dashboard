import type { PrepPlan } from "./prep-orders";
import {
  PREP_PLAN_KIND,
  buildInitialPrepPlan,
  rebuildPrepPlanAfterTakeProfit,
  refreshTakeProfitsAfterReplenish,
} from "./prep-orders";

function normalizePlan(plan: PrepPlan): PrepPlan {
  return { ...plan, planKind: PREP_PLAN_KIND };
}

const KEY = "prep-order-plans-v1";

function readAll(): Record<string, PrepPlan> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, PrepPlan>;
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, PrepPlan>) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function listPrepPlans(): PrepPlan[] {
  return Object.values(readAll()).map(normalizePlan).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function getPrepPlan(symbol: string): PrepPlan | null {
  const plan = readAll()[symbol];
  return plan ? normalizePlan(plan) : null;
}

export function savePrepPlan(plan: PrepPlan): PrepPlan {
  const normalized = normalizePlan(plan);
  const map = readAll();
  map[normalized.symbol] = normalized;
  writeAll(map);
  return normalized;
}

/** 第一笔头仓后生成预备订单（补仓+止盈） */
export function ensureInitialPrepPlan(symbol: string, headPrice: number, avgCost?: number): PrepPlan {
  const existing = getPrepPlan(symbol);
  if (existing && existing.phase === "initial" && !existing.hasTakenProfit) {
    return existing;
  }
  if (existing?.hasTakenProfit) return existing;
  return savePrepPlan(buildInitialPrepPlan({ symbol, headPrice, avgCost }));
}

/** 强制按头仓重建（用户手动） */
export function forceInitialPrepPlan(symbol: string, headPrice: number, avgCost?: number): PrepPlan {
  return savePrepPlan(buildInitialPrepPlan({ symbol, headPrice, avgCost }));
}

/** 止盈后：清头仓补仓，按均价回补并重算止盈 */
export function applyTakeProfitToPrepPlan(
  symbol: string,
  headPrice: number,
  avgCost: number,
  completedTakeProfitTiers?: number[],
): PrepPlan {
  return savePrepPlan(
    rebuildPrepPlanAfterTakeProfit({
      symbol,
      headPrice,
      avgCost,
      completedTakeProfitTiers,
    }),
  );
}

/** 回补后均价变化：刷新止盈与回补触发价 */
export function applyReplenishAvgCostToPrepPlan(symbol: string, newAvgCost: number): PrepPlan | null {
  const plan = getPrepPlan(symbol);
  if (!plan || !plan.hasTakenProfit) return null;
  return savePrepPlan(refreshTakeProfitsAfterReplenish(plan, newAvgCost));
}
