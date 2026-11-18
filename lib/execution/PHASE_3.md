# 第三阶段：交易所规则预检与卖出幂等保护

本阶段只增加纯逻辑预检与卖出事件保护，不发送 Binance 订单。实盘开关仍为 false。

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

## 尚未完成

已增加只读接口 `fetchSpotOrderByClientId` 与 `fetchSpotTrades`，可按客户端订单 ID 查询订单、读取 BUY/SELL 成交；同时增加 Binance `newClientOrderId` 格式的确定性 ID 与订单状态对账决策函数。\n\n当前仍未接入 POST /api/v3/order、自动订单轮询调度、撤单、成交到持仓成本/队列的完整联动、邮件发送以及 UI 操作面板。卖出 guard 和 IndexedDB 事件存储已建立，但尚未接入策略引擎的实际自动执行链路。所有交易动作都应继续处于模拟/预检状态。只有完成 Testnet 测试后，才考虑增加独立实盘开关。

## 2026-11-18：真实买入成交只读同步（新增，未接入 UI）

- `fill-reconcile.ts`：按订单 ID 过滤成交，核对 Binance 累计 executedQty / cummulativeQuoteQty 与逐笔成交之和；重复 fill ID 去重。
- 买入手续费以 USDT 扣除时按 USDT 计入成本；以基础币扣除时按该笔成交价格估值；BNB 等第三资产手续费不做错误估算，暂停记账并转人工复核。
- `store.browser.ts`：新增 `recordConfirmedBuyFill`，将 fill 唯一键、待买金额扣减、成交台账写入放入同一 IndexedDB readwrite 事务，避免多标签页并发时重复或覆盖成交金额。
- `sync-buy-order.browser.ts`：显式按待买订单 ID + attempt 查询 Binance 原订单与成交；仅对账，不会 POST、撤单或自动重试。网络错误、订单查不到、成交不完整、交易规则不符时转人工复核。
- `order-reconcile.ts`：补充 FILLED 但成交数量为 0 或缺失订单 ID 的异常保护。

新增纯逻辑测试：`fill-reconcile.test.ts`；扩展 `order-reconcile.test.ts`。尚未运行 npm 测试、typecheck 或浏览器 IndexedDB 集成测试。

仍未完成：买入 POST 与受控执行开关、自动轮询调度、卖出订单成交同步、策略信号接入、邮件 outbox/Worker 联动、UI 管理面板、Testnet 端到端验证。实盘保持关闭。