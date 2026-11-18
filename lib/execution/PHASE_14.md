# 第十四阶段：Spot 优先、Simple Earn 活期补足（资金调度规划）

## 用户确认的资金策略

- 闲置 USDT 留在 Simple Earn Flexible 赚取利息。
- 买入时优先使用 Spot USDT。
- Spot 不足时只赎回 Simple Earn Flexible 的差额。
- 不自动赎回 Locked Earn。
- Spot + Flexible Earn 仍不足时，保留未满足金额在待买队列，不扩大额度、不挪用其他资产。

## 本阶段代码

- `wallet-funds.ts`：Spot 优先资金分配纯函数。
- `earn-redemption.ts`：按 Flexible 产品 productId 分配赎回金额、创建稳定幂等意图、限制状态迁移、处理超时复核和到账核验。
- `earn-redemption.browser.ts`：读取 Spot、Flexible 持仓和本地预留，生成待买订单赎回计划；已有活动意图直接复用，不重复生成。
- `store.browser.ts`：IndexedDB 升级到 v4，新增 `earn-redemption-intents`，以事务方式保存赎回意图和状态。
- `binance.browser.ts`：按 Binance 实际返回字段读取 Flexible 持仓（`totalAmount`、`productId`、`canRedeem`、`collateralAmount`），归一化后保留 productId；Locked 持仓按 `amount` / `redeemingAmt` 读取；另有只读赎回历史查询。
- 不再把现货账户的 `LDUSDT` / `LD...` 代码猜测性地转换为基础资产；Simple Earn 持仓以专用 position API 为准。
- `BuyQueue.tsx`：新增“资金来源规划”，展示现货使用、活期计划赎回和未满足金额。
- 新增测试覆盖多产品拆分、同一产品重复意图、跨订单本地预留、超时转复核、赎回历史匹配和 Spot 到账确认。

## 资金计划规则

1. Spot free 先扣除其他买单的活动本地预留。
2. Spot 可用金额优先覆盖本次待买金额。
3. 只对差额分配 Flexible Earn USDT。
4. 分配按具体 productId 进行，并扣除交易所冻结、赎回中和其他订单本地赎回预留。
5. Locked Earn 永远不进入自动赎回分配。
6. 活期余额不足时返回未满足金额，不能扩大本次计划金额。

## 赎回幂等与恢复

- 每个买单 + Flexible productId 生成稳定意图 ID；重复刷新复用已有意图。
- 状态流转：planned → submitting → submitted → redeeming → credited。
- 请求超时或响应不明确时转 `reconcile_required`，不允许盲目重复提交。
- 赎回历史必须匹配确切的 Binance redemptionId、USDT、金额和 SPOT 目的账户。
- 只有赎回历史核实且 Spot free 相对赎回前基线增加足额，才标记 credited。
- 无 redemptionId、历史记录不唯一、金额不匹配或余额未到账时，转人工复核/继续等待，不允许启动买单。

## 当前执行边界（非常重要）

- 本阶段没有调用 Simple Earn redeem POST，也没有 Spot order POST。
- “资金来源规划”只发送 GET USER_DATA 请求并写入本地 IndexedDB，不会改变任何 Binance 资产。
- Binance 官方将 Flexible redeem 定义为 `POST /sapi/v1/simple-earn/flexible/redeem`，权限分类为 `TRADE`；赎回历史是 GET USER_DATA。当前用户 API Key 为只读，不能执行赎回。参考：[Binance Simple Earn API](https://developers.binance.com/en/docs/catalog/investment-and-services-simple-earn/api/rest-api/flexible-locked)。
- 真正自动赎回前，还必须解决浏览器端 API Secret 暴露问题，并实现受保护签名端、赎回提交器和错误恢复。需要用户更换/开启权限时会提前通知，不会要求现在开启。
- IndexedDB 是本浏览器本地状态；清除站点数据会丢失赎回意图。不能把本地意图当作 Binance 已赎回的事实。
