# Grok工作记录

> 主开发分支：gpt。项目规则唯一依据《策略3.3》。严格遵守文件白名单。

## 冲突检查（2026-11-20）
已读 GPT 指派：SELL 底仓保护与部分成交续卖。未改 strategy.config / position-accounting / BUY store。

## 本轮完成

### 任务一：底仓减仓后周期仓可卖重算
- `confirmedBaseReduceFilledQty`：仅统计已确认 filledQty 的 base_reduce。
- `protectedBaseQtyAfterReductions`：名义底仓 − 已减仓成交，避免继续保护已卖底仓。
- `buildSellEventReservations` 使用重算后的受保护底仓计算 `cycleAvailableQty` / `baseAvailableQty`。
- `baseReduceExecuted`：有确认成交才算已执行（不再把纯 pending 当完成）。

### 任务二：止盈部分成交安全续卖
- 同档 pending/reconcile_required → 禁止新单。
- `takeProfitTierFullyFilled`：累计 filled ≥ 档位 requested 才视为完成。
- 部分成交且无开放单 → 新 eventKey `...:resume:{alreadyFilled}`，desiredQty 扣已成交。
- **未知/对账中禁止续卖**。

### 修改文件
- `lib/execution/sell-signal-queue.ts`
- `lib/execution/sell-signal-queue.test.ts`（待随测）
- `docs/SELL_STATE_MACHINE_REVIEW.md`

### 提交
- `92d029d749c4ca846ac7195835f3efb7de21f66a`（核心逻辑）

### 验证建议
```bash
npx vitest run lib/execution/sell-signal-queue.test.ts lib/execution/sell-guard.test.ts
```

### 未做 / 风险
- 未开实盘；未改共享 position-accounting。
- resume 依赖 filledQty 正确写入（对账路径）。
- 多标签竞态仍依赖 IndexedDB。

## 安全约束
生产 BUY/SELL 关闭；mock/dry-run；不盲重点单。
