# 交易执行内核（开发阶段）

本阶段新增 `lib/trading/execution-core.ts`。这是纯函数执行内核，不包含 Binance 下单请求，也不会发起真实交易。

## 已实现

- 按计划金额、Binance USDT free、单币剩余额度三者最小值规划买单。
- 按 LOT_SIZE stepSize 向下取整，并检查交易对状态、minQty、maxQty、minNotional。
- 卖出数量同时受交易所 free 数量、策略持仓数量、周期仓可卖数量约束；长期底仓比例始终锁定。
- 用策略事件 ID + 币种 + 方向 + 档位生成稳定幂等键。
- 对网络结果不明确的提交标记为 `reconcile-required`，禁止直接重发。
- 累计成交量和成交额只允许单调增加，避免重复或倒退的成交同步覆盖状态。

## 重要边界

1. 规划数量不等于成交数量。只有交易所订单查询和成交明细确认后，才允许更新成交台账、剩余队列和持仓。
2. 部分成交的剩余金额应由上层订单队列根据真实累计成交额计算，不可用请求金额推断成交。
3. `reconcile-required` 必须先按 Binance `origClientOrderId` 查询原订单；查不到也需要进一步确认订单历史/成交记录，不能直接创建新订单。
4. 本阶段尚未实现 IndexedDB 持久化、Binance 下单/撤单适配器、订单查询对账、邮件触发，也没有实盘能力。
5. 自动卖出只能由已确认的 V3.3 卖出事件驱动，卖单数量还必须再次核对实际 free 余额和长期底仓保护。

## 测试

`lib/trading/execution-core.test.ts` 覆盖余额不足拆单、单币额度、交易所最小金额、交易对状态、底仓保护、幂等键、超时对账状态和累计成交单调性。

需要在项目环境执行：

```bash
npm test -- lib/trading/execution-core.test.ts
npm run typecheck
```

在本次远程仓库修改过程中没有运行 Node/npm，因此不能宣称测试已通过。
