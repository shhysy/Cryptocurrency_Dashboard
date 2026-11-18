# 第十四阶段：USDT 多账户分层（只读基础）

## 需求

USDT 可能分布于 Spot、Simple Earn Flexible/Locked、Funding 或其他账户。账户净值展示与现货买入资金不能使用同一个余额字段。

## 已完成

- 建立 `UsdtWalletBuckets` 和 `summarizeUsdtWallets`，分开统计 Spot free/locked、Flexible Earn、Locked Earn、Funding、其他账户和活动买入预留。
- 只有 Spot free 扣除活动预留后的余额属于可规划现货买入资金。
- Spot account 返回的 `LDUSDT` 凭证与普通 `USDT` 分开解析；不把 LDUSDT 当作现货可下单余额。
- 新增 `fetchSpotUsdtWalletBuckets` 只读接口。
- 更新账户余额 UI 文案，准确说明当前数据覆盖范围。
- 新增单元测试，覆盖账户分层、可执行余额、Earn/Funding 排除及异常数值。

## 尚未接入

- Funding 钱包只读余额。
- Simple Earn Flexible/Locked 全量持仓与分页。
- 赎回中、到期、提前赎回损失/限制等状态。
- 账户间划转历史与对账。

## 安全规则

- 不自动赎回理财，不自动从 Funding 划转到 Spot。
- 只有资产真实到达 Spot free 后才可用于现货买入。
- 未读取的账户来源必须显示为“未读取/未知”，不能把缺失数据当作 0 并宣称总资产完整。
- 不新增任何交易、赎回、划转 POST；真实下单仍关闭。
