# 第十四阶段：Spot 优先、Simple Earn 活期补足（资金调度规划）

## 用户确认的目标

- 闲置 USDT 留在 Simple Earn Flexible 赚取利息。
- 产生买入需求时，优先使用 Spot USDT。
- Spot 余额不足时，检查 Simple Earn Flexible 可用余额，只赎回本次缺口。
- 不自动提前赎回 Locked Earn。
- Spot 与 Flexible Earn 合计仍不足时，保留未满足金额在待买队列，不扩大额度、不挪用其他资产。

## 已完成的纯函数规划

- `planSpotFirstBuyFunding(requested, spotFreeAfterReservations, flexibleEarnAvailable)`：
  - 先分配 Spot 可用 USDT。
  - 只对剩余缺口计算 Flexible Earn 赎回金额。
  - Flexible Earn 不足时返回 `unfundedUsdt`，留待后续资金补足。
- Flexible Earn 可用余额扣除赎回中和冻结金额。
- Locked Earn 只纳入资产统计，不纳入即时买入规划。
- 现货资金仍先扣除其他活动买入预留。
- 新增测试覆盖现货优先、只赎回差额、理财余额不足、赎回中/冻结排除和异常数值。

## 重要执行边界

目前完成的是资金调度计划，不是实际赎回器。尚未新增 Simple Earn redeem POST，也没有下单 POST。后续实现时必须：
1. 为每个买入意图生成稳定的 redemption intent ID，避免重复赎回。
2. 赎回前再次读取 Spot free、Flexible Earn 可用额和活动预留，计算精确差额。
3. 赎回数量不得超过当前可赎回 Flexible Earn 数量，不能动 Locked Earn。
4. 提交赎回请求后先查询赎回记录/状态，确认到账 Spot 后重新读取 Spot free。
5. 只有到账金额足够且 Binance 交易对预检通过，才允许后续买单阶段继续。
6. 赎回超时、部分到账、接口错误或每日限额触发时，转人工复核或保留待买订单，绝不盲目重复提交。
7. 同时处理 API 签名权限和密钥安全；用户当前只读 Key 不具备赎回/交易能力。需要权限时提前通知用户。

## Binance 产品行为依据

Binance 官方帮助说明：符合条件的 Simple Earn Flexible 资产可用于 Spot 交易，资金顺序为 Spot Account 优先、Earn Flexible Assets 其次；用于订单的 Flexible 资产会自动赎回并停止计息。官方也提示赎回可能受每日限额、产品流动性、市场波动及网络延迟影响。因此系统必须将赎回状态和到账确认作为独立步骤，不能把理财持仓直接视为现货 free。
