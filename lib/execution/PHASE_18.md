# 第十八阶段：自动执行周期（实盘开关默认关闭）

## 本阶段实现

- 将 `ExecutionBackground` 提升为 Dashboard 根级组件；无论用户当前是否打开“待买队列”Tab，只要看板打开且标签页可见，后台周期都会运行。
- 每 30 秒进行一次买卖订单只读对账和成交 Outbox 投递；行情刷新后使用最新 DashboardData。
- 增加 gated execution cycle：
  - 仅在数据源为 Binance、数据非 stale、账户状态已知时进入执行分支。
  - BUY：读取币种当前累计成本，按策略 profile 固定成本上限计算剩余额度；先做 Spot 预检，再使用单次提交编排。
  - Simple Earn：只有 `LIVE_EARN_REDEMPTION_ENABLED` 开启时，才规划/提交 USDT Flexible Earn 缺口赎回；赎回历史和 Spot 到账核实后，后续周期再执行买入。
  - SELL：只允许止盈、指标止盈、追踪止损和受限底仓减仓事件；基本面退出不自动执行。
  - 每个周期最多提交一个买入订单和一个卖出订单；Flexible Earn 多产品赎回按已持久化 intent 逐个处理。
- 自动执行与只读对账分离；订单提交前仍需经过独立的最新余额/规则/仓位预检、IndexedDB 原子领取和确定性 clientOrderId。
- in-flight guard 跨 Dashboard 行情刷新保持，避免 effect 重建时重复处理同一事件。

## 重要安全约束

- `LIVE_SPOT_ORDER_SUBMISSION_ENABLED=false`
- `LIVE_SPOT_SELL_SUBMISSION_ENABLED=false`
- `LIVE_EARN_REDEMPTION_ENABLED=false`

以上三个开关均保持关闭。当前自动执行周期只会执行只读对账和已确认成交邮件投递，不会真实买入、卖出或赎回。

## 运行边界

- 自动周期依赖看板保持打开且标签页可见；浏览器关闭或设备休眠时不会运行。
- 当前仍未完成 Binance Spot Testnet 端到端演练。
- 自动申购 Simple Earn Flexible 尚未实现；只实现了买入缺口时的活期赎回规划/受控适配器。
- Locked Earn 不进入自动资金调度。
- 需要启用实盘前，必须完成测试网演练、密钥安全审查和用户明确确认。
