# 第三阶段：交易所规则预检、订单对账与卖出幂等保护

本阶段所有交易动作仍为预检、只读查询或本地账本写入；**没有 Binance 下单 POST、没有撤单，实盘开关保持关闭**。

## Binance 交易规则预检

- 只允许 USDT 报价交易对。
- 检查交易对状态是否为 TRADING。
- 读取 MARKET_LOT_SIZE（缺失时回退 LOT_SIZE）、NOTIONAL / MIN_NOTIONAL。
- 买入按当前可用 USDT 与策略剩余金额取较小值，并校验最小/最大名义金额及预计数量范围。
- 卖出数量向下按 stepSize 取整，并同时受 Binance free 数量、总持仓、周期仓和长期底仓保护线约束。

## 卖出幂等规则

- 卖出事件键必须由币种、卖出类型、源周线/档位组成；禁止使用刷新时间作为事件 ID。
- 事件在发起网络请求前必须原子写入 pending；网络超时进入 reconcile_required，先查单，不允许直接重发。
- 只有真实成交对账完成后才标记 executed。
- 普通止盈、指标止盈和追踪止损只允许卖周期仓。
- 底仓减仓必须显式标记为 V3.3 base_reduce 事件，并且每个底仓减仓事件只允许执行一次。
- 指标止盈按两周冷却、累计不超过初始周期仓 50% 进行限制。

## 2026-11-18：真实买入成交只读同步（未接入 UI）

- `fill-reconcile.ts`：按订单 ID 过滤成交，核对 Binance 累计 executedQty / cummulativeQuoteQty 与逐笔成交之和，并按成交 ID 去重。
- 买入手续费以 USDT 扣除时按 USDT 计入成本；以基础币扣除时按该笔成交价格估值；BNB 等第三资产手续费不做错误估算，暂停记账并转人工复核。
- `store.browser.ts`：`recordConfirmedBuyFill` 将 fill 唯一键、待买金额扣减、成交台账写入放入同一 IndexedDB readwrite 事务，避免多标签页并发重复或覆盖成交金额。
- `markBuyOrderReconcileRequired` / `markBuyOrderReconciled`：从 IndexedDB 最新记录原子更新复核状态，避免用过期页面状态覆盖刚写入的成交。
- `sync-buy-order.browser.ts`：显式按待买订单 ID + attempt 查询 Binance 原订单与成交；仅对账，不会 POST、撤单或自动重试。网络错误、订单查不到、成交不完整、交易对不匹配时转人工复核。
- `order-reconcile.ts`：拒绝 NEW / PARTIALLY_FILLED / FILLED 状态与成交累计字段矛盾的快照。

新增纯逻辑测试：`fill-reconcile.test.ts`；扩展 `order-reconcile.test.ts`。尚未运行 npm 测试、typecheck 或浏览器 IndexedDB 集成测试。

## 尚未完成

- Binance POST /api/v3/order、撤单与安全执行开关。
- 买入订单自动轮询调度、卖出订单成交同步。
- 将 V3.3 策略信号接入买卖队列和卖出 guard。
- 持仓成本、周期仓/底仓数量、实现盈亏的完整成交联动。
- 买卖成交邮件 outbox / Worker 联动及 UI 管理面板。
- 本地 npm test、npm run typecheck 和 Binance Spot Testnet 端到端验证。

`sync-buy-order.browser.ts` 必须由上层显式调用；它不自动重试，也不发送邮件。只有在交易所订单与逐笔成交完全匹配后，才会写入真实成交台账。实盘保持关闭。
