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
- `signal-queue.ts`：将新鲜 Binance 看板中未被阻止的 V3.3 头仓/补仓/备用金信号，按最后一根已完成周线生成稳定事件键并写入待买队列。
- `sell-signal-queue.ts`：将新鲜 Binance 卖出信号转换为稳定事件键，并通过 `sell-guard.ts` 保护周期仓、底仓、指标止盈累计比例与冷却时间；只预留事件，不提交卖单。
- `components/BuyQueue.tsx` / `components/SellQueue.tsx`：展示待买金额、成交金额、剩余金额、待卖事件和对账状态；买入队列支持 CSV 备份及只读 DRY_RUN 预检。
- `binance.browser.ts`：USDT free、交易对过滤器、按客户端订单 ID 查询订单，以及读取 BUY/SELL 成交（只读）。
- `binance-order.browser.ts`：重新读取 USDT free 与交易对过滤器，结合队列剩余金额和单币剩余额度计算本次可预检金额；固定 `DRY_RUN`，绝不提交订单。

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
- 卖出信号目前只完成事件预留和 guard，尚未自动提交卖单或同步卖出成交。
- 持仓成本、周期仓/底仓数量、实现盈亏的完整成交联动。
- 买卖成交邮件 outbox / Worker 联动及 UI 管理面板。
- 买卖成交邮件 outbox / Worker 联动及 Binance Spot Testnet 端到端验证。

`signal-queue.ts` 与 `sell-signal-queue.ts` 已由浏览器直连 Dashboard 在数据新鲜且账户读取成功后自动调用；重复刷新通过稳定事件键避免重复入队。`BuyQueue` 的只读预检按钮重新读取账户 USDT free 和交易规则，显示本次可执行金额与剩余计划金额，但不会下单。`sync-buy-order.browser.ts` 目前必须由上层显式调用；它不自动重试，也不发送邮件。实盘保持关闭。`lib/trading/` 是早期通用原型，暂不接入页面；不要同时启用两套交易存储。

## 第四阶段：Binance 买入执行适配器（DRY_RUN）

- `binance-order.browser.ts`：新增买入执行前置适配器，重新读取现货 USDT `free`、交易对过滤器，并结合待买订单剩余金额、单币剩余成本上限进行预检。
- 生成确定性 `clientOrderId`，便于未来真实订单提交后通过 `origClientOrderId` 对账。
- 余额不足时按余额缩小本次可执行金额；不足交易所最小名义金额时返回阻止原因并保留待买金额。
- 适配器结果明确标记 `mode=DRY_RUN`、`submitted=false`；`assertLiveOrderSubmissionDisabled` 对任何真实下单尝试 fail-closed。
- 新增 `binance-order.browser.test.ts` 覆盖部分余额、单币剩余额度、低于最小名义金额、复核状态阻断和实盘关闭。

**本阶段没有 Binance `POST /api/v3/order`，没有自动重试、撤单或余额预留。** 由于当前账户 API Key 仍是只读，且浏览器端 Secret 无法保密，本阶段不加入签名下单代码。后续必须先解决受保护的签名执行边界，并为多个并发待买订单增加原子 USDT 资金预留，才可进入真实订单提交阶段。

## 第五阶段：USDT 本地资金预留与成交释放

- IndexedDB 数据库升级到 v2，新增 `buy-funds-reservations` store；既有订单、成交和台账 store 保留。
- `fund-reservation.ts`：按 Binance 最新 USDT free 扣除其他订单的活动预留，计算本次可预留额度；支持余额不足时部分预留和交易所最小名义金额拦截。
- `store.browser.ts`：在单个 IndexedDB readwrite 事务内读取活动预留并写入订单预留，利用同一数据库事务的串行化避免多个浏览器标签页重复分配本地余额。
- 同一订单重复请求会返回现有活动预留，不重复占用资金；成交对账按累计确认支出更新剩余预留，避免轮询多次重复扣减。
- 只有订单进入 Binance 已确认终态（FILLED/CANCELED/EXPIRED/REJECTED）才释放剩余预留；订单仍为 NEW/PARTIALLY_FILLED 时保留未成交资金。
- `reserveQueuedBuyFundsDryRun` 读取账户余额和交易规则后建立本地预留，但仍明确 `submitted=false`，不会发送任何订单请求。

**限制：** IndexedDB 预留只协调本应用/同一浏览器配置中的标签页，不是 Binance 侧锁仓；外部手动交易、其他设备或余额变化仍可能使快照过期。未来真实提交前必须再次读取 free，并在受保护执行端做最终余额和额度校验。浏览器数据清除也会丢失本地预留记录，不能将其视为交易所真实冻结资金。
