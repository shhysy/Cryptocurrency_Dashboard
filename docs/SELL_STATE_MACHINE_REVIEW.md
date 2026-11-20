# SELL 全链路状态机审查（Grok）

> 更新：2026-11-20。策略 3.3 + 用户 A2/B2 口径。不开启实盘。

## 状态

`pending` → `reconcile_required` / `partially_filled` / `executed` / `blocked`

- **pending / reconcile_required**：占用周期仓预约量；`reconcile_required` **禁止**同档新单与续卖。
- **partially_filled**：已有确认成交但未达 requestedQty；订单终态后允许同档 **resume** 剩余目标（新 eventKey）。
- **executed**：若 filledQty ≥ requestedQty，档位满足；若仍不足，与部分成交同样可 resume（由 `takeProfitTierFullyFilled` 判定）。

## 底仓保护重算

- 名义底仓 = 累计买入 × baseRatio。
- **受保护底仓** = 名义底仓 − 已确认 `base_reduce` 成交数量（filledQty）。
- 周期仓可卖参考：`min(持仓 − 受保护底仓, 初始周期仓 − 未完成周期类预约)`。
- 仅 pending 的 base_reduce **不算**已执行；避免未成交就锁死减仓档。

## 止盈续卖护栏

1. 同档存在 pending / reconcile_required → 禁止新单。
2. 同档累计 filled ≥ 该档目标 requested → 禁止新单。
3. 部分成交且无开放/未知单 → 可生成 `...:resume:{alreadyFilled}` 事件，desiredQty 扣减已成交。
4. LIVE 关闭时 submit 仍拒绝真实 POST。

## 残留风险

- 多标签 claim 竞态依赖 IndexedDB。
- 部分成交与手续费第三资产路径需与共享成交台账一致（不在本模块改 position-accounting）。
- 未做测试网真单验收。
