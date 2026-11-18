# 第三阶段：交易所规则预检、买入队列、订单对账与卖出幂等保护

本阶段所有交易动作仍为预检、只读查询或本地账本写入；**没有 Binance 下单 POST、没有撤单，实盘开关保持关闭**。

## Binance 交易规则预检

- 只允许 USDT 报价交易对。
- 检查交易对状态是否为 TRADING。
- 读取 MARKET_LOT_SIZE（缺失时回退 LOT_SIZE）、NOTIONAL / MIN_NOTIONAL。
- 买入按当前可用 USDT 与策略剩余金额取较小值，并校验最小/最大名义金额及预计数量范围。
- 卖出数量向下按 stepSize 取整，并同时受 Binance free 数量、总持仓、周期仓和长期底仓保护线约束。

## 买入信号入队与成交对账

- `signal-queue.ts`：仅接收新鲜 Binance 数据、账户读取成功、未被策略阻止的 V3.3 BUY 信号。
- 事件键使用币种 + 头仓/补仓/备用金档位 + 最近已完成周线时间；重复刷新通过 IndexedDB 唯一 ID 去重。
- 入队金额使用策略经过单币成本上限后的 `action.usdt`；实际可执行金额仍需在未来提交前按 USDT free、单币剩余额度和交易所过滤器再次计算。
- `fill-reconcile.ts)：按订单 ID 过滤成交，核对 Binance 累计 executedQty / cummulativeQuoteQty 与逐笔成交之和，并按成交 ID 去重。
- 买入手续费以 USDT 扣除时按 USDT 计入成本；以基础币扣除时按该笔成交价格估值；BNB 等第三资产手续费不做错误估算，暂停记账并转人工复核。
- `store.browser.ts`：`recordConfirmedBuyFill` 将 fill 唯一键、待买金额扣减、成交台账写入放入同一 IndexedDB readwrite 事务。
- `sync-buy-order.browser.ts`：显式按待买订单 ID + attempt 查询 Binance 原订单与成交；仅对账，不会 POST、撤单或自动重试。

## 卖出幂等规则

- 卖出事件键必须由币种、卖出类型、源周线/档位组成；禁止使用刷新时间作为事件 ID。
- 事件在发起网络请求前必须原子写入 pending；网络超时进入 reconcile_required，先查单，不允许直接重发。
- 只有真实成交对账完成后才标记 executed。
- 普通止盈、指标止盈和追踪止损只允许卖周期仓。
- 底仓减仓必须显式标记为 V3.3 base_reduce 事件，并且每个底仓减仓事件只允许执行一次。
- 指标止盈按两周冷却、累计不超过初始周期仓 50% 进行限制。

## 页面表现

`components/BuyQueue.tsx` 在 Dashboard 展示待买队列、已成交金额、剩余金额和复核状态，并支持导出 CSV。浏览器直连模式在数据新鲜且账户读取成功后会自动将合格 BUY 信号入队；不发送订单。

## 尚未完成

- Binance POST /api/v3/order、撤单与安全执行开关。
- 自动订单轮询调度、买入/卖出成交的完整同步。
- 将 V3.3 卖出信号接入卖出 guard。
- 持仓成本、周期仓/底仓数量、实现盈亏的完整成交联动。
- 买卖成交邮件 outbox / Worker 联动。
- 本地 npm test、npm run typecheck 和 Binance Spot Testnet 端到端验证。

实盘保持关闭；待买队列入队不代表已经提交订单或发生真实成交。
