# V3.3执行层

本目录 `lib/execution/` 是当前唯一执行层开发入口。具体策略参数以根目录 `策略3.3.xlsx` 和 `docs/策略3.3/策略3.3用户确认决策.md` 为准；本文件只说明代码架构、模块职责与安全边界。

## 当前架构

1. **行情与账户数据：** Dashboard 通过同源 `/api/dashboard` 获取服务端数据；需要签名的 Binance 只读请求由 `/api/binance/signed-read` 代理。API Key/Secret 仅由服务端环境变量读取，不进入浏览器包。
2. **执行编排：** 浏览器侧 `ExecutionBackground` 在看板打开且标签页可见时运行周期任务；待买队列、待卖事件、资金预留和成交 Outbox 使用 IndexedDB。页面关闭后不会有常驻后台执行。
3. **订单边界：** BUY/SELL统一通过同源服务端 `/api/binance/spot-order` 路由；服务端按 `BINANCE_SPOT_ENVIRONMENT` 选择Spot Testnet或Production端点，并分别校验 `BINANCE_TESTNET_BUY_ENABLED`、`BINANCE_TESTNET_SELL_ENABLED`、`BINANCE_PRODUCTION_BUY_ENABLED`、`BINANCE_PRODUCTION_SELL_ENABLED`。四路授权相互隔离，生产BUY/SELL开关默认关闭；生产路径虽然已有服务端适配器，但尚未完成账户级持久化协调、后台调度和最终生产验收，不能视为可直接实盘。旧 `/api/binance/testnet-order` 仅作为测试网兼容入口。
4. **邮件通知：** 浏览器 Outbox 通过同源 `/api/trade-fill-notifications` 提交，服务端验证 Cloudflare Access 后使用 HMAC 转发到独立 Worker。Worker 只发送已确认成交邮件，不访问 Binance、不计算策略、不下单。

## 主要模块

| 模块 | 职责 |
|---|---|
| `queue.ts` / `store.browser.ts` | 待买队列、IndexedDB事务、成交去重与买入账本 |
| `signal-queue.ts` | 将符合条件的买入信号幂等入队 |
| `sell-signal-queue.ts` / `sell-guard.ts` | 卖出事件入队、周期仓与底仓保护、止盈档位限制 |
| `sell-store.browser.ts` | 卖出事件持久化、领取与订单绑定 |
| `fund-reservation.ts` | 按最新USDT可用余额进行本地资金预留 |
| `binance-preflight.ts` / `binance-order.browser.ts` | 交易对过滤器、数量精度、最小名义金额与DRY_RUN预检 |
| `buy-order-submit.browser.ts` / `sell-order-submit.browser.ts` | 受控测试网订单提交编排；生产开关关闭 |
| `sync-buy-order.browser.ts` / `sync-sell-order.browser.ts` | 只读查单、成交核对与状态恢复 |
| `fill-reconcile.ts` / `position-accounting.ts` | 成交事实校验、加权平均成本、底仓/周期仓及实现盈亏回放 |
| `earn-redemption.browser.ts` / `wallet-funds.ts` | Spot与Simple Earn Flexible资金规划及受控赎回适配 |
| `notification-outbox.ts` / `notification-dispatch.browser.ts` | 已确认成交事件持久化、幂等投递与失败重试 |

## 不可绕过的安全规则

- 只有交易所确认成交才能改变持仓、成本、已执行档位或触发成交完成邮件。
- 买入只使用 Binance Spot USDT `free`，不把其他币种余额折算为USDT；仍须检查单币固定成本上限与交易所过滤器。
- E2已确认不按账户净值比例、现金比例、组合回撤或单周净值比例压缩固定单币额度；这不免除真实USDT余额、单币上限及订单预检。
- 普通止盈、指标止盈和追踪止损不得卖出受保护底仓；底仓减仓必须使用单独授权事件。
- B2止盈口径：积极型倍数2/3/5，保守型1.3/1.6/2；三档比例50%/30%/80%，依顺序及实际剩余周期仓执行。
- G2只允许展示层软失败并标记STALE；执行侧不得把STALE数据视为新鲜数据。
- 超时或订单状态不明必须按客户端订单ID对账；未查清前不得盲目重发。
- 生产现货BUY/SELL与Simple Earn自动赎回保持关闭。测试网演练不等于实盘验收。

## 当前验收边界

- 单元测试：`npm test`；类型检查：`npm run typecheck`。
- 测试通过不代表已完成真实浏览器多标签页验证、Spot Testnet端到端演练、历史回测或样本外验收。
- 页面关闭期间不会持续轮询；IndexedDB只在同一浏览器配置内协调，不是交易所资金锁，也不保证跨设备同步。
- 第三资产手续费、外部转入/转出或本地成交账本不一致时，必须暂停自动记账/执行并人工复核。
- 生产交易上线前必须完成回测、样本外、测试网全链路和独立风险验收，并另行获得用户明确授权。

## 历史记录与早期原型

- [执行层历史阶段记录](./PHASE_HISTORY.md)：合并保留原阶段文档，内容只作历史追溯，不作为当前状态依据。
- `lib/trading/`：早期通用执行内核原型，未接入Dashboard；当前不得与 `lib/execution/` 并行启用。
