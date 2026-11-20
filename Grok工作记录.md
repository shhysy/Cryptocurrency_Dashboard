# Grok工作记录

> 主开发分支：gpt。Issue #2。按《自动交易系统总需求清单》GROK-SELL-01～05 推进。

## 本轮交付（需求清单）

### GROK-SELL-01
同周 partial 终态 + 对账证明 → 生成 `resume` 剩余量；活动 pending / 全成交 / 无证明 / 零成交禁止 resume。

### GROK-SELL-02
`hasOpenBaseReduce` 跨周生效（pending / reconcile_required / 无证明 partial）。
未完结时**冻结该币全部卖出**；旧周终态证明不占用。

### GROK-SELL-03～04（此前已合入，本轮确认）
台账强制 SELL+base_reduce、重复 fillId 冲突、半 step 容差已移除、stepSize 前置 fail-closed。

### GROK-SELL-05
专项 + 集成测试齐全；本地 `npm test` 54/452、`typecheck` 通过。**关闭条件：GPT 独立复核。**

### GROK-SELL-06
未开始（须 SELL 复核通过后）。

### 本地证据
```
npm test → 54 files / 452 tests 通过
npm run typecheck → 通过
```

### 约束
未改 GPT 共享模块；Outbox/生产交易关闭。
