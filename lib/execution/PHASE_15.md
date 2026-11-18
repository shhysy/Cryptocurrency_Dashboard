# 第十五阶段：受控的 Spot 市价买单提交适配器（默认关闭）

## 本阶段实现

- `binance.browser.ts` 新增 `submitSpotMarketBuy`，使用 Binance Spot `POST /api/v3/order`。
- 只支持 USDT 报价的 MARKET BUY，参数使用 `quoteOrderQty`，并传入稳定的 `newClientOrderId`。
- `newOrderRespType=FULL`；响应必须包含匹配的 symbol/clientOrderId、有效 orderId 和已知订单状态。
- 新增 `LIVE_SPOT_ORDER_SUBMISSION_ENABLED=false`，默认在任何网络请求前 fail-closed。
- `buy-order-submit.browser.ts` 串联只读预检、现货资金本地预留、原子领取 attempt、一次 POST 和提交结果复核状态。
- `claimBuyOrderSubmission` 在 IndexedDB 单事务中将订单移入 `reconcile_required` 并递增 attemptCount；并发标签页不能领取同一待买订单。
- 请求超时或响应异常时保留本次 attempt 和资金预留，不自动重发；必须先通过 `clientOrderId` 查询订单。
- `BuyQueue.tsx` 新增执行买入入口（默认禁用）和手动“核对 Binance 买单”按钮。
- 真实成交仍由 `syncBuyOrderFromBinance` 查询订单和逐笔成交；只有核对通过后才能更新买入金额、成交台账与通知 Outbox。

## 关键执行规则

1. 预检必须通过，且 quoteOrderQty 必须满足当前交易对规则。
2. 只提交本地资金预留覆盖的 USDT 金额，不将 Flexible Earn 未到账金额算入 Spot free。
3. 先持久化 attempt，再发送 POST；不能先发单后补本地状态。
4. 每次 attempt 只允许一个 POST；网络超时不重试。
5. 通过客户端订单 ID 对账，订单仍为 NEW / PARTIALLY_FILLED 时等待，不创建第二笔订单。
6. 成交量/金额和逐笔成交不一致时进入人工复核。
7. 买入成交通知只在成交核验和台账入账成功后生成。

## 当前边界

- `LIVE_SPOT_ORDER_SUBMISSION_ENABLED=false`，当前不会发送 Spot BUY POST。
- 用户现有 Binance Key 仍为只读；真正提交订单需要 TRADE 权限，启用前会再次通知用户。
- 浏览器直连会暴露前端 bundle 中的 API Secret；用户已选择私人自用方式并接受该风险。只可使用专用 API Key、固定 IP 白名单，禁止提现、划转、合约等无关权限。
- BUY 已有单次提交编排；SELL 目前只有底层 POST 适配器和 clientOrderId 对账恢复，完整卖单提交编排、自动轮询调度与 Spot Testnet 端到端测试仍未完成。
- 本地 IndexedDB 预留不是 Binance 侧锁仓；最终执行前仍必须重新读取 Spot free 和交易对规则。

