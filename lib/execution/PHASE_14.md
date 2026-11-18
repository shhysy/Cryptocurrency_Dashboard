# 第十四阶段：Spot + Simple Earn USDT 只读接入

## 用户确认的账户范围

只接入 Binance 现货账户与理财账户（Simple Earn）。不接入 Funding、合约或其他钱包。

## 已完成

- Spot USDT：读取 `free` 和 `locked`。
- Simple Earn Flexible：读取 USDT 持仓，分别统计总额、赎回中和冻结金额。
- Simple Earn Locked：读取 USDT 持仓并单独展示，不纳入即时买入规划。
- Flexible / Locked 持仓支持分页，异常余额或冻结/赎回数量超过持仓总额时拒绝计算。
- 资金规划模型区分 Spot free、Flexible Earn 可规划余额、Locked Earn 和活动预留。
- 修正此前错误：不再通过 Spot account 的 `LDUSDT` 资产标识推断 Simple Earn Flexible 余额。

## 关于理财账户交易

Binance 官方说明，符合条件的 Simple Earn Flexible 资产可以用于 Spot 交易，交易资金顺序为 Spot Account 优先，其次 Earn Flexible Assets；使用时对应资产会从 Flexible 产品赎回并停止计息。Locked Earn 不等同于 Flexible Earn，不纳入即时买入规划。

本项目目前只实现只读持仓读取和资金规划展示。当前 DRY_RUN 订单适配器仍以 Spot free 作为实际可执行余额；尚未验证 API 下单时是否能直接消费 Flexible Earn，或是否必须先调用 Simple Earn redeem。后续会在受控测试中验证，不能把“资金规划可用”误认为“订单 API 已可用”。

## 安全边界

- 所有本阶段新增请求均为 GET USER_DATA。
- 不赎回、不申购、不划转、不下单。
- 不需要 Binance 交易权限。
- 不把 Locked Earn 或赎回中的金额当作即时可用余额。
