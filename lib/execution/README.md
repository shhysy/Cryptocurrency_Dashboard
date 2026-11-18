# V3.3 执行层（开发中）

当前统一的策略执行模块位于 `lib/execution/`。当前代码只覆盖金额预检、订单状态建模、只读成交对账与本地幂等记录；**没有任何 Binance 下单 POST 调用，实盘开关仍关闭**。

## 已有模块

- `queue.ts` / `store.browser.ts`：USDT 待买队列、部分金额规划、IndexedDB 原子入队、成交 ID 去重与成交台账。
- `csv.ts`：导出 `待买入订单.csv`；CSV 是备份，不是浏览器自动读写的唯一数据源。
- `binance-preflight.ts`：Binance 交易对状态、数量步长、USDT 报价精度、最小/最大名义金额预检；普通卖出保护长期底仓。
- `sell-guard.ts` / `sell-store.browser.ts`：卖出事件去重、周期仓限制、指标止盈冷却/累计上限、底仓减仓限制和 IndexedDB 事件预留。
- `client-order-id.ts` / `order-reconcile.ts`：生成确定性客户端订单 ID，并对超时/订单状态作出 wait、partial、safe-to-retry 或 manual-review 决策。
- `fill-reconcile.ts`：核对订单累计成交量/金额与逐笔成交；USDT 或基础币手续费可确定性换算，BNB 等第三资产手续费不猜值，转人工复核。
- `sync-buy-order.browser.ts`：按待买订单 ID + attempt 只读查询指定订单及成交，只将已确认成交写入买入队列与台账，不会下单、撤单或重试。
- `binance.browser.ts`：USDT free、交易对过滤器、按客户端订单 ID 查询订单，以及读取 BUY/SELL 成交（只读）。

## 不可绕过的执行规则

1. 买入只使用 Binance 现货 USDT `free`，不折算其他币。
2. BTC/PAXG 成本上限各 1,000 USDT；其他币种各 500 USDT。卖出不释放额度。
3. 订单超时必须按 `origClientOrderId` 查单；NEW / PARTIALLY_FILLED 不可重发；查不到订单转人工复核。
4. 成交支出超过待买订单剩余金额时拒绝自动记账。
5. 普通止盈、指标止盈和追踪止损不能触及长期底仓；底仓减仓必须是单独授权事件。
6. 只有交易所成交记录核实后才能更新队列、成交台账和发送成交完成邮件。

## 本轮新增的买入成交对账

- `recordConfirmedBuyFill` 将成交 ID 去重、待买金额扣减和成交台账写入同一 IndexedDB readwrite 事务，避免多标签页并发重复记账或丢失金额更新。
- `sync-buy-order.browser.ts` 需要显式传入待买订单 ID 和 attempt；只适用于已存在 Binance 订单的只读对账，不会自动启动下单。
- 手续费以 USDT 扣除时按 USDT 计入成本；以基础币扣除时按成交价格估值；以 BNB 等第三资产扣除时暂停记账，要求后续可靠换算，避免低估成本。
- 新增 `fill-reconcile.test.ts`，并扩展 `order-reconcile.test.ts` 覆盖异常订单状态。

## 尚未完成

- Binance `POST /api/v3/order`、撤单与自动订单轮询。
- 买入订单自动轮询调度与卖出成交同步。
- 将 V3.3 策略信号接入买卖队列和卖出 guard。
- 持仓成本、周期仓/底仓数量、实现盈亏的完整成交联动。
- 买卖成交邮件 outbox / Worker 联动及 UI 管理面板。
- 本地 `npm test`、`npm run typecheck` 和 Binance Spot Testnet 端到端验证。

`sync-buy-order.browser.ts` 目前必须由上层显式调用；它不自动重试，也不发送邮件。实盘保持关闭。`lib/trading/` 是早期通用原型，暂不接入页面；不要同时启用两套交易存储。
