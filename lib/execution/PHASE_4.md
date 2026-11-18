# 第四阶段：Binance 买入执行适配器（DRY_RUN）

## 本阶段交付

- 新增 `binance-order.browser.ts`，把待买队列订单转换为 Binance 市价买入预检结果。
- 每次预检重新读取现货账户 USDT `free` 和交易对过滤器，不使用账户净值，不把其他币种折算为 USDT。
- 实际预检金额取待买订单剩余金额、USDT free、单币剩余成本上限三者的最小值。
- 交易对必须为 `TRADING`、报价资产必须为 USDT，并校验 `quoteOrderQtyMarketAllowed`、最小/最大名义金额、预计数量限制。
- 余额不足时允许部分金额预检；若低于交易所最小名义金额则不执行，剩余金额仍留在待买队列。
- 使用 `clientOrderIdForEvent(eventKey, attemptCount)` 生成稳定客户端订单 ID，供未来订单查询和对账。
- `LIVE_ORDER_SUBMISSION_ENABLED` 固定为 false；任何调用 `assertLiveOrderSubmissionDisabled` 的真实下单路径都会被拒绝。

## 安全边界

本阶段是只读预检，不包含 Binance `POST /api/v3/order`、撤单、自动重试或成交写账。适配器返回 `submitted: false`，不表示订单已提交或成交。

当前浏览器直连模块仍然存在客户端签名读取接口；浏览器 bundle 无法保护 API Secret。因此不能把交易权限 Secret 放入 `NEXT_PUBLIC_*` 或前端源码。真实下单前需要独立审查并实现受保护的签名执行端点。当前只读 API Key 无法验证下单，也不应尝试绕过权限。

## 尚未完成 / 下一阶段前置条件

1. 对所有待买订单进行原子 USDT 资金预留，避免多个队列同时使用同一笔 `free` 余额。
2. 结合真实成交和手续费资产，计算单币累计真实成本及剩余额度；不能用计划金额代替成交成本。
3. 建立服务端签名/提交边界，并明确实盘开关、IP 白名单、仅现货交易权限和禁提现约束。
4. 提交后以 `origClientOrderId` 查询原订单；网络超时必须先对账，不能盲目重复 POST。
5. 完成 Spot Testnet 的订单、部分成交、拒单、超时和重复事件端到端测试。

当前实盘保持关闭。
