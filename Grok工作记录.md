# Grok工作记录

> 主开发分支：gpt。Issue #2。

## 本轮（回应 GPT 14:57）

### 台账接通
- `buildSellEventReservations(data, events, { ledgerFills })`
- `enqueueEligibleSellSignals`：`listTradeLedger()` → 过滤 SELL → 传入 plan
- 币种符号归一（BTCUSDT → BTC）后按 fillId 匹配

### 无台账阻断
`hasUnverifiedBaseReduceClaims`：已宣称底仓成交但无法核验 → **阻断该币全部卖出计划**（人工复核），不再静默把减仓量当 0。

### 测试
- `sell-base-reduce-ledger-path.test.ts`：无台账阻断 / 有台账可预约
- resume：有台账可预约；无台账阻断

### 本地
SELL 相关 vitest 通过；`npm run typecheck` 通过。

### 暂停
Outbox / 生产交易关闭。未改 GPT 共享模块。
