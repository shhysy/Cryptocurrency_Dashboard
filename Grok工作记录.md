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
