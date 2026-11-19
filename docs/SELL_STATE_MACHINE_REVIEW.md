# SELL 全链路状态机审查（Grok · 模拟/只读）

> 日期：2026-11-19。仅审查与文档，不开启实盘。不修改 BUY/store 共享实现。

## 1. 模块与职责

| 模块 | 职责 |
|------|------|
| `sell-signal-queue.ts` | 将看板卖出信号转为稳定事件键，经 sell-guard 后写入待卖事件（不提交交易所） |
| `sell-store.browser.ts` | 本地卖出事件持久化、claim、绑定 exchangeOrderId |
| `sell-preflight.browser.ts` / `sell-order.browser.ts` | 只读预检与 dry-run |
| `sell-order-submit.browser.ts` | LIVE 关闭时直接拒绝；开启后单次 POST，失败进 reconcile_required |
| `sync-sell-order.browser.ts` | 只读查单与成交，确认后才记账 |
| `sell-guard.ts` | 幂等、周期仓/底仓边界、指标止盈冷却与累计上限 |

## 2. 期望状态迁移

```text
pending
  →（claim + clientOrderId）submitting / 已绑定 clientOrderId
  → submitted（交易所返回 orderId）或 reconcile_required（超时/不明）
  → partial（部分成交，按实际 qty 记账）
  → terminal（filled / canceled 等）后才释放锁定并允许后续策略动作
```

## 3. 已确认的护栏

1. **LIVE 关闭**：`submitQueuedSellEvent` 在任何网络请求前抛错，不写交易所。
2. **不明状态**：catch 后将事件置 `reconcile_required` 并保留 `clientOrderId`，文案禁止自动重发。
3. **guard**：`base_reduce` 必须 `allowBaseReduction === true`；普通止盈/追踪止损不得动底仓可用额度。
4. **通知**：Outbox 仅由已确认 `ExecutionFill` 构造，不能从 pending 卖单直接生成「已成交」通知。

## 4. 残留风险（需后续或 GPT 边界内配合）

1. 浏览器多标签页对同一 `eventKey` 的 claim 竞态依赖 IndexedDB 事务，需真机多标签验证。
2. `fundamental_exit` 明确不走自动卖出，必须人工。
3. 部分成交与手续费第三资产（如 BNB）路径与 BUY 侧一样需 fail-closed，细节在 sync-sell 与共享 fill 逻辑中。
4. 实盘开关开启前必须完成测试网全链路：信号 → 事件 → dry-run →（可选）极小额 → 对账 → 通知。

## 5. 本轮代码动作

- 修复 `sell-guard` 未授权 `base_reduce` 误放行（CI P0）。
- 补充 guard / 通知签名与成交构造边界测试。
- **未**打开 `BINANCE_SPOT_SELL_SUBMISSION_ENABLED`。
