# Grok 工作记录

> 本文件由 Grok 维护。工作说明使用中文（代码除外）。唯一开发分支：`gpt`。

## 冲突检查
已读 `gpt工作记录.md`。预备订单与 `post-take-profit-rebuy` 双轨；不把 CSV 接入自动下单。本轮只改 prep 允许文件。

## 本轮完成（人工计划完善）
- `planKind: manual_prep`、输入校验、`validatePrepPlan`
- CSV 增加 planKind；store 归一化
- UI 标明「人工计划 / 非挂单」
- 测试：`lib/execution/prep-orders.test.ts`

修改文件：`prep-orders.ts`、`prep-orders-csv.ts`、`prep-store.browser.ts`、`prep-orders.test.ts`、`PrepOrdersPanel.tsx`

提交 SHA：
- `3052483b6e0c63da45e2ce9834198d606a50a1c3`（核心）
- `f5cf74e199f784073c40a878777108d80d7cd803`（CSV/store/测试）
- `a4b482c1c7588ea7f6d3920702795d9c5e5b5a32`（UI）

请本地：`npx vitest run lib/execution/prep-orders.test.ts`

未做：自动止盈侦测、接入自动下单（禁止）、与主策略投影合并。


## GPT / Grok 分工约定（2026-11-19）

本轮并行开发统一使用 `gpt` 分支，双方按文件白名单隔离，避免互相覆盖。

### Grok 负责：预备订单人工计划与 CSV
**负责文件：**
- `lib/execution/prep-orders.ts`
- `lib/execution/prep-orders-csv.ts`
- `lib/execution/prep-store.browser.ts`
- `lib/execution/prep-orders.test.ts`
- `components/PrepOrdersPanel.tsx`
- 上述模块直接对应的独立文档和测试。

**工作目标：**
- 完善人工计划生成、输入校验、止盈后重建、回补后触发价刷新。
- CSV 作为导出快照，不作为自动执行真源。
- UI 明确标记「人工计划 / 非交易所挂单 / 非自动执行」。
- 补齐预备订单纯逻辑单元测试。
- 每轮完成后更新本文件，写明修改文件、测试命令/结果、commit SHA、CI URL。

**禁止修改：**
- `components/Dashboard.tsx`
- `lib/execution/fund-reservation.ts`
- `lib/execution/store.browser.ts`
- `lib/execution/buy-order-submit.browser.ts`
- `lib/execution/sync-buy-order.browser.ts`
- 成交台账、资金预留、自动执行开关。

### GPT 负责：资金预留与买入订单恢复安全
GPT 负责资金预留事务、并发预留/认领、部分成交扣减、终态释放、旧 attempt 隔离、IndexedDB 恢复与异常 fail-closed。Grok 不修改以上 GPT 负责文件。

### 共同约束
- 双方均不修改 `components/Dashboard.tsx`，避免共享 UI 冲突。
- 不将 localStorage/CSV 预备订单计划接入自动下单；自动执行真源仍是已确认交易所订单与成交台账。
- 不开启实盘 BUY/SELL，不启用 Simple Earn 自动赎回，不用真实余额测试，不发送真实订单。
- 若必须跨越文件边界，先在双方记录中提出并协商，不能直接覆盖另一方实现。

### 当前 Grok 进度
- 已完成：预备订单增加 `planKind: manual_prep`、输入校验、`validatePrepPlan`；CSV/store 字段归一化；UI 标注「人工计划 / 非挂单」。
- 修改文件与提交 SHA 见本记录「本轮完成（人工计划完善）」章节。
- 当前只报告本地单测命令 `npx vitest run lib/execution/prep-orders.test.ts`；完整 CI 结果需以 GitHub Actions 实际状态为准。
