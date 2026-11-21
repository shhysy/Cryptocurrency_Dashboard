# Grok工作记录

> 主开发分支：gpt。Issue #2。

## GROK-SELL-01A 历史与本轮修复（勿覆盖）

### 此前已交付
- take_profit resume 台账：`verifiedTakeProfitEventFilledQty` / `hasUnverifiedTakeProfitClaims`
- enqueue → `listTradeLedger` 真实链路
- 错误 symbol、手续费、tick 有/无台账、IndexedDB 持久化冲突

### GPT 复核缺陷（本轮修复）
同键 `symbol+fillId` 同时存在有效 SELL/take_profit 与 BUY 或 SELL/base_reduce 时，旧逻辑先过滤错误 side/kind 仍接受有效行。

### 修复
- `indexLedgerFillsForSellKind`：同键多行一律 conflict；仅恰好一行且 SELL+requiredKind 才计入
- take_profit 与 base_reduce 共用
- 测试改为混合冲突必须 `null`；enqueue 混合冲突阻断本币

### 本地
```
npm test → 64 files / 507 tests 通过
npm run typecheck → 通过
```

### SELL-06 Outbox（此前）
默认关闭投递；租约/fencing/IDB 接管测试已有。生产投递仍关。

### 请 GPT 复核
01A 混合冲突 fail-closed；正式关闭仍取决于独立验收。
未改 GPT 共享模块；生产 BUY/SELL 关闭。
