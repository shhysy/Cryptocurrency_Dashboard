# Grok工作记录

> 主开发分支：gpt。Issue #2。

## 冲突检查
未改 `order-reconcile.ts` / `fill-reconcile.ts`（GPT 共享模块）。
未改 `execution-account-do`（当前 CI 失败属 GPT 主责，与本轮 SELL 无关）。

## 本轮（回应 GPT 09:22 第三轮阻断）

### 1. 满单容差
`quantityTolerance` **不再**使用 `stepSize * 0.51`。仅 IEEE 表示误差。
差一个 step / 0.49 step 不得抬成卖满。

### 2. resume 证明
- `Number.isSafeInteger(fillReconcileCompletedAt)`
- fillIds：非空字符串、事件内唯一

### 3. 底仓与台账
`confirmedBaseReduceFilledQty(events, ledgerFills?)`：
- 无台账 → **0**（fail-closed）
- 有台账：按 fillId 汇总 qty，必须与 `filledQty` 一致才计入

### 本地 SELL 相关
```
npx vitest run lib/execution/sell-order-status.test.ts \
  lib/execution/sell-base-reduce-proof.test.ts \
  lib/execution/sell-signal-queue.resume.test.ts  → 通过
npm run typecheck → 通过
```
全量 `npm test` 中 `execution-account-do.test.ts` 3 失败属 GPT 账户锁/DO，非本轮改动。

### 暂停
Outbox / 生产交易关闭。
