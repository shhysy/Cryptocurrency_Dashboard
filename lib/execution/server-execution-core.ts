export type ServerExecutionSide = "BUY" | "SELL";

export type ServerExecutionState =
  | "queued" | "preflight" | "reserved" | "submitting" | "unknown"
  | "reconciling" | "partial_open" | "partial_terminal" | "filled"
  | "canceled" | "expired" | "rejected" | "manual_review";

export interface ServerExecutionIntent {
  intentId: string;
  strategyEventId: string;
  strategyVersion: "3.3";
  symbol: string;
  side: ServerExecutionSide;
  quoteAsset: "USDT";
  /** BUY使用USDT金额；SELL使用基础资产数量，均以十进制字符串保存。 */
  amount: string;
  state: ServerExecutionState;
  attempt: number;
  createdAt: number;
  updatedAt: number;
  exchangeOrderId: string | null;
  clientOrderId: string | null;
  exchangeTerminalAt: number | null;
  fillsReconciledAt: number | null;
  lastError: string | null;
}

export interface ExecutionLease {
  intentId: string;
  attempt: number;
  token: string;
  leaseUntil: number;
}

const DECIMAL_AMOUNT = /^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/;

export function serverExecutionIntentId(strategyEventId: string): string {
  return `v33:${strategyEventId}`;
}

const TRANSITIONS: Record<ServerExecutionState, readonly ServerExecutionState[]> = {
  queued: ["preflight", "manual_review"],
  preflight: ["reserved", "queued", "manual_review"],
  reserved: ["submitting", "queued", "manual_review"],
  submitting: ["unknown", "reconciling", "manual_review"],
  unknown: ["reconciling", "manual_review"],
  reconciling: ["partial_open", "partial_terminal", "filled", "canceled", "expired", "rejected", "unknown", "manual_review"],
  partial_open: ["reconciling", "manual_review"],
  partial_terminal: ["queued", "manual_review"],
  filled: [],
  canceled: [],
  expired: [],
  rejected: [],
  manual_review: ["reconciling"],
};

export function validateServerExecutionIntent(
  input: Pick<ServerExecutionIntent, "intentId" | "strategyEventId" | "strategyVersion" | "symbol" | "side" | "quoteAsset" | "amount" | "createdAt">,
): string | null {
  if (!/^[A-Za-z0-9:_-]{1,156}$/.test(input.strategyEventId)) return "策略事件 ID 格式无效";
  if (input.intentId !== serverExecutionIntentId(input.strategyEventId)) return "订单意图 ID 与策略事件幂等键不匹配";
  if (input.strategyVersion !== "3.3") return "订单意图策略版本不匹配";
  if (!/^[A-Z0-9]{5,24}$/.test(input.symbol) || !input.symbol.endsWith("USDT")) return "交易对必须为USDT报价现货格式";
  if (input.side !== "BUY" && input.side !== "SELL") return "订单方向无效";
  if (input.quoteAsset !== "USDT") return "当前执行层只允许 USDT 报价资产";
  if (typeof input.amount !== "string" || !DECIMAL_AMOUNT.test(input.amount) ||
      !Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0) {
    return "订单金额或数量必须是正数十进制字符串";
  }
  if (!Number.isSafeInteger(input.createdAt) || input.createdAt <= 0) return "订单意图创建时间无效";
  return null;
}

export function canTransitionExecutionState(
  from: ServerExecutionState,
  to: ServerExecutionState,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transitionExecutionIntent(
  intent: ServerExecutionIntent,
  nextState: ServerExecutionState,
  now: number,
  patch: Partial<Pick<ServerExecutionIntent,
    "exchangeOrderId" | "clientOrderId" | "exchangeTerminalAt" | "fillsReconciledAt" | "lastError" | "attempt">> = {},
): ServerExecutionIntent {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error("订单状态更新时间无效");
  if (!canTransitionExecutionState(intent.state, nextState)) {
    throw new Error(`不允许订单状态从 ${intent.state} 转换为 ${nextState}`);
  }
  const next = { ...intent, ...patch, state: nextState, updatedAt: now };
  if (next.attempt < intent.attempt || !Number.isInteger(next.attempt)) {
    throw new Error("订单 attempt 不允许回退或使用无效值");
  }
  if (nextState === "partial_terminal" || nextState === "filled" ||
      nextState === "canceled" || nextState === "expired" || nextState === "rejected") {
    if (!Number.isSafeInteger(next.exchangeTerminalAt) || (next.exchangeTerminalAt as number) <= 0 ||
        !Number.isSafeInteger(next.fillsReconciledAt) ||
        (next.fillsReconciledAt as number) < (next.exchangeTerminalAt as number)) {
      throw new Error("订单终态必须有交易所终态快照和完整成交对账时间");
    }
  }
  if (nextState === "partial_open" &&
      (next.exchangeTerminalAt !== null || next.fillsReconciledAt !== null)) {
    throw new Error("仍在交易所开放的部分成交不能带终态/最终对账时间");
  }
  if (nextState === "submitting" && (!next.clientOrderId || next.attempt <= 0)) {
    throw new Error("提交前必须持久化 clientOrderId 和正数 attempt");
  }
  if (nextState === "unknown" && (!next.clientOrderId || next.attempt <= 0)) {
    throw new Error("未知提交结果必须保留 clientOrderId 和正数 attempt 供后续查单");
  }
  return next;
}

/** 每次状态写入都必须匹配intent、attempt和leaseToken。 */
export function assertExecutionLease(
  current: ExecutionLease | null,
  expected: Pick<ExecutionLease, "intentId" | "attempt" | "token">,
  now: number,
): void {
  if (!current || !expected.intentId || !expected.token || !current.token ||
      current.intentId !== expected.intentId || current.attempt !== expected.attempt ||
      current.token !== expected.token || !Number.isSafeInteger(current.attempt) ||
      current.attempt <= 0 || !Number.isSafeInteger(current.leaseUntil) ||
      !Number.isSafeInteger(now) || now <= 0 || current.leaseUntil <= now) {
    throw new Error("执行租约已过期或fencing token不匹配；拒绝写入");
  }
}
