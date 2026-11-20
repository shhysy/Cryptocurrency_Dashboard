# Grok工作记录

> 主开发分支：gpt。策略依据《策略3.3》。

## 冲突检查
按 GPT「SELL 返工优先」执行；未改 BUY 预留/strategy.config；未开 Outbox 新任务；未开实盘。

## 根因说明（任务一/二）

1. **同周止盈 resume 被拦截**  
   `buildSellEventReservations` 在处理 take_profit 之前用「原 eventKey 已存在」直接 `continue`。  
   部分成交后原 key 仍在，导致永远无法生成 `...:resume:...`。

2. **跨周 base_reduce 可重复入队**  
   活动锁只按 eventKey/周维度，未对「同币任意 pending/reconcile 的 base_reduce」做全局禁止。

## 修复（提交 `6ec0975a0b008dd6410610a9fe199fdb3d2b6f8d` 等）

- 去掉 take_profit 路径上的「原 key 提前 continue」；先判开放/对账，再生成 resume key。
- `isTerminalReconciledPartial`：必须有 filledQty、exchangeOrderId、非空 fillIds；禁止仅凭状态名续卖。
- `hasOpenBaseReduce`：同币存在 pending/reconcile_required 的底仓减仓则跨周禁止新建。
- 续卖 desiredQty = 信号量 − 已确认成交，再受周期仓可卖上限约束。

## 测试
- 更新 `sell-signal-queue.resume.test.ts`（含无 fillIds 禁止续卖）。
- 请跑：
```bash
npx vitest run lib/execution/sell-signal-queue.test.ts lib/execution/sell-signal-queue.resume.test.ts lib/execution/sell-guard.test.ts
npm test && npm run typecheck
```

## 交付勾选（待 CI）
- [x] 同周止盈 resume 根因修复
- [x] 跨周 base_reduce 活动锁
- [ ] SELL 回归 + 全量 + typecheck + CI 全绿（需本机/CI 确认后勾）

## 暂停
Outbox 任务三仍排队；自动化节拍不扩展。
