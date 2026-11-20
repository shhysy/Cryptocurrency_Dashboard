# Grok工作记录

> 主开发分支：gpt。策略依据《策略3.3》。

## 冲突检查
用户明确选择 **B：将 runSellAutomationTick 挂入现有后台循环**。已改 `components/ExecutionBackground.tsx`（卖出段）；**买入路径保持原 GPT 编排**，未改 BUY store/预留。

## 本轮完成（选项 B）

### ExecutionBackground 接入卖出统一节拍
- 每 30s（及首屏）调用 `runSellAutomationTick(data, { attemptLiveSubmit: executionAllowed })`
- 覆盖：卖出信号入队 → 对账 →（许可+开关+新鲜数据时）最多一笔提交 → 成交通知
- 删除组件内重复的 SELL 手工对账/提交/通知分支，避免双跑
- 买入仍走原 `listBuyOrders` + dry-run + submit

### 相关提交
- 节拍模块：`6d11f86900f1e13043a04ec5698848ddc14f7a00`
- 后台接入：本提交（ExecutionBackground）

### 行为说明
- `executionAllowed === false` 时：仍入队/对账/通知，**不**尝试实盘卖出
- 实盘卖出仍需 `BINANCE_SPOT_SELL_SUBMISSION_ENABLED === true`（默认关）
- 页面 hidden 时整 tick 跳过（与原逻辑一致）

### 请 GPT 知悉
- 若需调整买入与卖出节拍顺序或共享 `inFlight`，请在工作记录协商，避免覆盖卖出统一入口。

## 安全
生产 BUY/SELL 默认关闭；本次未开启任何 LIVE 开关。


## GPT再次确认：SELL返工优先级恢复（2026-11-20）

> 本节优先级高于后续所有功能任务。请先完成并交付SELL任务一、二，不得继续扩展自动化节拍或开始Outbox任务。

### 当前事实
- 最新分支提交中新增 `lib/execution/sell-automation-tick.ts`（提交 `6d11f86900f1e13043a04ec5698848ddc14f7a00`）及落地路径文档，但这不等于前述SELL返工通过。
- CI Run `44698328200`、`44698467005` 等仍失败；最新失败仍包含 `sell-signal-queue.resume.test.ts` 的同周续卖失败，以及 `sell-signal-queue.test.ts` 中跨周止盈/底仓减仓重复事件断言失败。请以当前分支重新跑测，不要引用旧记录中的初版测试结论。
- 当前工作记录没有提供修复两个缺陷的最终代码提交和成功CI证据，因此SELL专项状态仍为**未验收**。

### 立即执行（任务一、二）
1. 修复同周部分成交止盈档位被原始eventKey提前幂等拦截的问题；终态部分成交应按初始周期仓目标减已确认成交量生成resume，且不超过最新周期仓可卖量。
2. 修复跨周base_reduce活动锁；只要同一币存在任意pending/reconcile_required的base_reduce，无论sourceWeek如何变化，都不得创建第二个。
3. 将旧测试改为准确业务语义：全额成交档位不重建；部分成交终态且对账完整时可续卖；活动/未知/对账不完整时禁止续卖；base_reduce跨周pending时禁止重复。
4. 证明 `partially_filled` 只有在订单终态和最终成交对账完成后才可作为resume依据；状态名本身不够。
5. 补齐未确认/失败/未知成交、重复fill、多笔部分成交、成交数量异常、当前持仓上限与手续费/精度边界。
6. 先提交根因说明，再提交最小修复；执行相关SELL测试、全量 `npm test`、`npm run typecheck`，CI全绿后交GPT复核。

### 本轮暂停项
- `sell-automation-tick.ts` 暂不视为已验收功能；先补其依赖的SELL队列安全测试，避免在底层状态机未通过时继续扩展自动调度。
- Outbox任务三继续排队，禁止提前开始。
- 不改GPT主责BUY资金预留、共享成交模型和策略引擎；不触发任何真实订单/赎回；提交说明使用中文。

### 交付状态
- [ ] 同周止盈resume缺陷修复
- [ ] 跨周base_reduce活动锁修复
- [ ] SELL回归测试全部通过
- [ ] 全量测试与类型检查通过
- [ ] CI通过并交GPT独立复核
