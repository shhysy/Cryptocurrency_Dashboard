# Grok 工作记录

> 维护者：Grok。说明文字使用中文（代码标识除外）。唯一开发分支：`gpt`。

## 冲突检查（本轮）
已读 `gpt工作记录.md` Phase 32。本轮只改通知 Outbox 纯函数/测试、dispatch 投递前校验、sell-guard 测试；**未改** `store.browser.ts`、BUY 资金预留、Dashboard。

---

## 本轮完成：成交通知可靠性 + 卖出保护单测（2026-11-19）

### A. 成交通知 Outbox
- 新增纯函数：`tradeNotificationRetryDelayMs`、`applyTradeNotificationLeaseClaim`、`applyTradeNotificationSent`、`applyTradeNotificationFailed`（与 store 退避公式对齐，可单测租约围栏）。
- `notification-dispatch.browser.ts`：投递前 `assertDispatchableEvent`（必须是 `confirmed_trade_fill`、sending + leaseToken）。
- 扩展 `notification-outbox.test.ts`：退避、租约过期重领、旧令牌拒绝 sent/failed。

### B. 卖出链路（模拟/审查）
- `sell-guard.test.ts`：补充追踪止损只动周期仓、底仓减仓未授权拒绝。
- 既有 `sell-order-submit`：实盘关闭时拒绝 POST（未改开关）。

### 修改文件
- `lib/execution/notification-outbox.ts`
- `lib/execution/notification-outbox.test.ts`
- `lib/execution/notification-dispatch.browser.ts`
- `lib/execution/sell-guard.test.ts`

### 提交 SHA
- `440c8b6c1fb528dd1162de04f3779e389e0d8c8c`（outbox 纯函数）
- `422f87201c542660e90b218302799b4c2d0e593b`（测试等）
- `b6133c154aa4d306365500ec472dfad43519bc67`（dispatch 校验 + sell-guard 用例）

### 建议验证
```bash
npx vitest run lib/execution/notification-outbox.test.ts lib/execution/sell-guard.test.ts
```

### 未做 / 边界
- 未改 IndexedDB store 实现（属 GPT 文件边界）；纯函数供对齐与测试。
- 未开 LIVE 卖出；未发真实订单。
- 路由/HMAC 既有逻辑未改密钥与 Worker 部署。

---

## 给 GPT 的任务指派（请写入 gpt工作记录.md）

**要求：说明、注释、工作记录尽量使用中文；代码标识符可保留英文。**

### 任务线：BUY 资金预留并发与 IndexedDB 恢复（延续 Phase 32）
1. 核验预留预算核算与写入是否在同一 readwrite 事务中；两订单并发预留不得超额。
2. 补充浏览器 IndexedDB 并发测试：不同订单并发预留、同订单幂等、并发 claim 仅一胜。
3. 浏览器重启/重载后恢复测试；transaction abort / blocked 时 fail-closed。
4. 不引入未审查依赖；不以纯 mock 冒充跨标签页原子性。
5. **不修改** Grok 白名单文件（notification-outbox / PrepOrders / sell-guard 等）；不改 Dashboard。
6. 完成后在 `gpt工作记录.md` 用中文写明：改动文件、测试结果、commit SHA、CI。

---

## 历史摘要
- 预备订单人工计划：`planKind: manual_prep`、校验、CSV、UI 非挂单说明。
- 实盘开关保持关闭。
