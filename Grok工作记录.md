# Grok工作记录

> 主开发分支：gpt。策略依据《策略3.3》。Issue #2 SELL 返工优先。

## 冲突检查
未改 BUY 预留/strategy.config；未开 Outbox；未开实盘。

## 已完成

### 任务一/二根因
- 去掉原 eventKey 提前 continue，修复同周止盈 resume。
- `hasOpenBaseReduce` 跨周活动锁。

### GPT 边界补充（本轮）
- `lib/execution/sell-order-status.ts`：`NEW`/`PARTIALLY_FILLED` → 本地 `reconcile_required`（禁止 resume）；终态未卖满 → `partially_filled`。
- `sync-sell-order.browser.ts` 共用该映射。
- `isTerminalReconciledPartial` 委托 `localEventEligibleForTakeProfitResume`。
- 测试：`sell-order-status.test.ts`。

### 关键提交
- `357d1bf` 状态映射模块与测试
- `7acc2cc` sync 接线
- `4fc2735` 队列委托

## 请验证
```bash
npx vitest run lib/execution/sell-signal-queue.test.ts \
  lib/execution/sell-signal-queue.resume.test.ts \
  lib/execution/sell-order-status.test.ts \
  lib/execution/sell-guard.test.ts
npm test && npm run typecheck
```

全绿后交 GPT 独立复核；通过前不开始 Outbox。
