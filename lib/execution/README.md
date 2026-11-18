# V3.3 执行层（开发中）

当前统一的策略执行模块位于 `lib/execution/`。所有新增能力目前仅用于金额预检、订单状态建模和本地幂等记录；**没有任何 Binance 下单 POST 调用，实盘开关仍关闭**。

## 已有模块

- `queue.ts` / `store.browser.ts`：USDT 待买队列、部分金额规划、IndexedDB 原子入队、成交 ID 去重与成交台账。
- `csv.ts`：导出 `待买入订单.csv`；CSV 是备份，不是浏览器自动读写的唯一数据源。
- `binance-preflight.ts`：Binance 交易对状态、数量步长、USDT 报价精度、最小/最大名义金额预检；普通卖出保护长期底仓。
- `sell-guard.ts` / `sell-store.browser.ts`：卖出事件去重、周期仓限制、指标止盈冷却/累计上限、底仓减仓限制和 IndexedDB 事件预留。
- `client-order-id.ts`：生成 Binance 可接受长度的确定性客户端订单 ID。
- `order-reconcile.ts`：对订单状态作出 wait / complete / partial / safe-to-retry / manual-review 决策。
- `binance.browser.ts`：USDT free、交易对过滤器、按客户端订单 ID 查询订单，以及读取 BUY/SELL 成交（只读）。

## 不可绕过的执行规则

1. 买入只使用 Binance 现货 USDT `free`，不折算其他币。
2. BTC/PAXG 成本上限各 1,000 USDT；其他币种各 500 USDT。卖出不释放额度。
3. 订单超时必须按 `origClientOrderId` 查单；NEW / PARTIALLY_FILLED 不可重发；查不到订单转人工复核。
4. 成交支出超过待买订单剩余金额时拒绝自动记账。
5. 普通止盈、指标止盈和追踪止损不能触及长期底仓；底仓减仓必须是单独授权事件。
6. 只有交易所成交记录核实后才能更新队列、成交台账和发送成交完成邮件。

## 尚未完成

- Binance `POST /api/v3/order`、撤单与自动订单轮询。
- 将真实订单、成交明细、待买余额和持仓成本以事务方式完整联动。
- 把 V3.3 策略信号接入买卖队列和卖出 guard。
- 买卖成交邮件联动及 UI 管理面板。
- 本地 `npm test`、`npm run typecheck` 和 Binance Spot Testnet 端到端验证。

`lib/trading/` 是早期通用原型，暂不接入页面；不要同时启用两套交易存储。详见 `lib/trading/README.md`。
