# 执行层历史阶段记录

> 本文件为历史开发档案，合并原 `PHASE_*.md` 阶段记录以减少文件分散。各阶段描述反映当时的实现状态，不代表当前状态或当前策略参数。当前模块结构与安全边界以同目录 `README.md`、根目录 `策略3.3.xlsx` 及策略用户决策记录为准。原始阶段正文按阶段顺序保留，便于追溯。


---

<!-- 原文件：lib/execution/PHASE_3.md -->

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
- `sell-signal-queue.ts`：将止盈、指标止盈、追踪止损和底仓减仓信号预留为唯一卖出事件；普通卖出受周期仓限制，底仓减仓单独授权，指标止盈执行 2 周冷却与周期仓 50% 累计上限；止盈档位不重复预留。

## 卖出幂等规则

- 卖出事件键必须由币种、卖出类型、源周线/档位组成；禁止使用刷新时间作为事件 ID。
- 事件在发起网络请求前必须原子写入 pending；网络超时进入 reconcile_required，先查单，不允许直接重发。
- 只有真实成交对账完成后才标记 executed。
- 普通止盈、指标止盈和追踪止损只允许卖周期仓。
- 底仓减仓必须显式标记为 V3.3 base_reduce 事件，并且每个底仓减仓事件只允许执行一次。
- 指标止盈按两周冷却、累计不超过初始周期仓 50% 进行限制。

## 页面表现

`components/BuyQueue.tsx` 与 `components/SellQueue.tsx` 在 Dashboard 展示待买队列和待卖事件。浏览器直连模式在数据新鲜且账户读取成功后自动将合格 BUY 信号入队、将合格 SELL 信号预留为卖出事件；不发送订单。

## 尚未完成

- Binance POST /api/v3/order、撤单与安全执行开关。
- 自动订单轮询调度、买入/卖出成交的完整同步。
- 将卖出事件接入 Binance 自动卖单提交和真实成交同步。
- 持仓成本、周期仓/底仓数量、实现盈亏的完整成交联动。
- 买卖成交邮件 outbox / Worker 联动。
- 本地 npm test、npm run typecheck 和 Binance Spot Testnet 端到端验证。

实盘保持关闭；待买队列入队不代表已经提交订单或发生真实成交。

---

<!-- 原文件：lib/execution/PHASE_4.md -->

# 第四阶段：Binance 买入执行适配器（DRY_RUN）

## 本阶段交付

- 新增 `binance-order.browser.ts`，把待买队列订单转换为 Binance 市价买入预检结果；待买队列提供“只读预检”按钮，显示 USDT free、本次可执行金额、预计数量和剩余计划金额。
- 每次预检重新读取现货账户 USDT `free` 和交易对过滤器，不使用账户净值，不把其他币种折算为 USDT。
- 实际预检金额取待买订单剩余金额、USDT free、单币剩余成本上限三者的最小值。
- 交易对必须为 `TRADING`、报价资产必须为 USDT，并校验 `quoteOrderQtyMarketAllowed`、最小/最大名义金额、预计数量限制。
- 余额不足时允许部分金额预检；若低于交易所最小名义金额则不执行，剩余金额仍留在待买队列。
- 使用 `clientOrderIdForEvent(eventKey, attemptCount)` 生成稳定客户端订单 ID，供未来订单查询和对账；当队列存储的是基础币代码时，预检会补全 USDT 交易对。
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

---

<!-- 原文件：lib/execution/PHASE_5.md -->

# 第五阶段：USDT 本地资金预留与成交释放

## 本阶段交付

- IndexedDB schema 从 v1 升级到 v2，新增 `buy-funds-reservations`。
- 通过 `planBuyFundsReservation` 从最新 USDT free 中扣除其他活动队列订单的预留金额，再为当前订单分配金额。
- 同一订单预留幂等；多个标签页通过同一 IndexedDB readwrite transaction 串行化，防止在本地重复分配同一笔 USDT。
- 允许部分预留；若可预留余额低于 Binance 最小名义金额则拒绝预留并保留待买订单。
- 通过 `applyConfirmedBuyReservationSpend` 根据累计成交支出计算预留剩余金额，重复轮询相同成交快照不会重复扣减。
- 订单仍处于 NEW / PARTIALLY_FILLED 时保留未成交部分；只有已确认的终态订单才释放剩余预留。
- `syncBuyOrderFromBinance` 在成交明细与订单累计数据一致后，更新对应的本地资金预留。

## 安全边界

本阶段只建立浏览器本地资金预留，不提交订单、不撤单、不自动重试。预留不是 Binance 的真实冻结余额，也不能阻止用户在其他设备或其他应用花费 USDT。真实提交前必须重新读取账户 free 并在受保护的执行端进行最终校验。

IndexedDB 仅在当前浏览器配置中持久化；清理站点数据或更换设备可能丢失预留状态。它不能取代服务端账本或交易所订单核对。

## 后续工作

1. 在 Spot Testnet 验证账户余额变化、订单成交/部分成交/终态释放的完整生命周期。
2. 为跨设备/服务端执行建立持久化资金账本及并发控制。
3. 审查旧 `lib/trading/` 原型与当前 `lib/execution/`，确保只有一套执行存储和执行入口。
4. 完成安全的服务端签名执行边界；届时再通知用户需要启用现货交易权限。当前仍不需要交易权限，实盘保持关闭。

---

<!-- 原文件：lib/execution/PHASE_6.md -->

# 第六阶段：自动卖出预检适配器（DRY_RUN）

## 本阶段交付

- 新增 `sell-order.browser.ts`，对已入队卖出事件进行 Binance 市价卖出预检。
- 卖出预检必须接收明确的已对账持仓快照：现货 free 数量、总持仓数量、受保护底仓数量。
- 普通止盈、指标止盈和追踪止损只能使用周期仓；按现货 free、周期仓可用量和 Binance filters 取可卖数量。
- 只有 `base_reduce` 类型可跨越底仓保护线，且仍受策略层 guard 限制。
- 暂不允许 `fundamental_exit` 进入自动卖出预检，直到基本面失效退出和底仓清仓授权规则单独完成审查。
- 新增测试覆盖普通周期仓卖出、可卖数量裁剪、底仓保护、单独底仓减仓和实盘关闭。

## 安全边界

本阶段只预检，不提交 Binance 卖单、不撤单、不写成交、不更新持仓。卖出预检不从历史买入记录推测当前持仓，必须使用已对账的真实持仓快照。

## 尚未完成

1. 自动卖单提交与订单幂等（当前没有 Binance `POST /api/v3/order`）。
2. 卖出订单查询、逐笔成交和手续费核算。
3. 周期仓/底仓数量、成本与实现盈亏的统一账本。
4. 成交确认后的邮件 outbox / Worker 通知。
5. Binance Spot Testnet 端到端验证。

当前仍不需要交易权限，实盘保持关闭。

---

<!-- 原文件：lib/execution/PHASE_7.md -->

# 第七阶段：真实成交邮件 Outbox（本地持久化）

## 本阶段交付

- IndexedDB 执行数据库升级到 v3，新增 `notification-outbox` store。
- 只有经过 Binance 订单与逐笔成交核验、并成功写入买入成交台账的 BUY fill，才会创建邮件事件。
- Outbox 事件与唯一成交 ID 在同一个 IndexedDB readwrite transaction 中写入；重复对账不会重复创建邮件事件。
- 事件 ID 使用 `trade-fill:<symbol>:<exchangeTradeId>`，供邮件 Worker 做幂等去重。
- Outbox 只保存成交必要字段，不保存 API Key、Secret、账户余额或账户总资产。
- 提供读取 outbox、确认发送、记录失败状态的存储接口。
- 新增纯函数校验器和单元测试，校验成交字段并验证稳定事件 ID。

## 安全边界

本阶段不直接发送邮件、不调用 Worker、不产生交易请求。只有交易所成交核验通过后才生成 outbox 事件。策略信号、待买队列和未成交订单不会生成成交邮件。

IndexedDB 是浏览器本地持久化；清除站点数据可能丢失尚未投递的通知。Outbox 入队不等于邮件已发送或送达。

## 尚未完成

1. Worker 接收成交事件的受保护接口与 KV 幂等去重。
2. 浏览器/服务端投递调度、失败重试与重复投递处理。
3. SELL 成交对账与 SELL outbox 事件。
4. 邮件服务接受、发送和最终送达状态的区分。
5. Binance Spot Testnet 买卖完整端到端验证。

当前仍然不需要 Binance 交易权限；本阶段没有下单代码。

---

<!-- 原文件：lib/execution/PHASE_8.md -->

# 第八阶段：签名成交邮件接收端

## 目标

把“Binance 已确认成交 → IndexedDB Outbox”与邮件发送服务建立安全协议，但不在浏览器中保存任何邮件服务密钥或 Binance 密钥。

## 本阶段提交

- `workers/trade-fill-email.js`：独立的买卖成交通知 Worker。
- `wrangler.trade-fill-email.jsonc`：独立 Worker 配置与 KV binding。
- `workers/TRADE_FILL_EMAIL_SETUP.md`：部署说明、安全边界与幂等限制。
- `lib/execution/notification-signature.server.ts`：服务端 HMAC-SHA256 签名 helper。
- `lib/execution/notification-signature.server.test.ts`：签名 helper 测试。

## 接收协议

请求头：
- `X-Trade-Timestamp`：Unix 毫秒时间戳。
- `X-Trade-Signature`：HMAC-SHA256 十六进制签名。

签名原文：
```text
<timestamp>.<raw-request-body>
```

请求体：
```json
{
  "events": [
    {
      "id": "trade-fill:BTCUSDT:123456",
      "type": "confirmed_trade_fill",
      "side": "BUY",
      "symbol": "BTCUSDT",
      "fillId": "123456",
      "exchangeOrderId": "987654",
      "filledQty": 0.001,
      "fillPrice": 65000,
      "quoteQty": 65,
      "commission": 0.000001,
      "commissionAsset": "BTC",
      "commissionUsdt": 0.065,
      "filledAt": 1795000000000
    }
  ]
}
```

Worker 验证签名、时间窗口和字段后，过滤 KV 已发送事件，发送邮件，再写入 KV。客户端不能传收件人，也不能通过策略信号字段触发邮件。

## 仍然关闭的部分

- Worker 尚未部署。
- 尚未创建/绑定 KV、Resend Secret 或邮件收件人配置。
- 浏览器 Outbox 尚未接入 dispatcher。
- 同源服务端转发 API 尚未创建，因为当前项目没有可确认的身份验证机制；不能开放匿名转发接口。
- SELL 成交仍没有完整的 Binance 对账与统一台账写入流程。
- 没有 Binance 下单 POST，也没有自动卖出；实盘继续关闭。

## 下一阶段前置条件

1. 先确认看板的身份验证方式：优先 Cloudflare Access，或项目已有的可靠登录态。
2. 服务端路由验证身份后才可读取/接收 Outbox 事件；禁止仅凭 Origin、CORS 或公开 URL 授权。
3. 由服务端签名并转发至 Worker；浏览器不得持有 HMAC Secret。
4. 成功确认后才将 Outbox 事件标记 sent；失败保留 pending/failed 并可重试。
5. 如果要求强并发幂等，使用 Durable Object 原子 claim，而不是把 KV 描述为强一致锁。

---

<!-- 原文件：lib/execution/PHASE_9.md -->

# 第九阶段：卖出成交核对与原子入账基础

## 已完成

- 新增 `reconcileConfirmedSellFills`，按 Binance SELL 订单累计成交量/金额核对逐笔成交。
- 校验逐笔成交方向必须为 SELL，且交易对、订单 ID 匹配。
- USDT 手续费直接计入手续费估值；基础币手续费按该笔成交价格估值；第三资产手续费不做猜测，要求人工复核。
- 新增 `recordConfirmedSellFill`，在同一个 IndexedDB 事务中写入唯一成交键、成交台账和邮件 Outbox。
- 买入/卖出 Outbox 使用相同事件结构和稳定成交 ID。
- 测试覆盖卖出方向错误、第三资产手续费、订单累计值不匹配和 SELL 通知事件。

## 仍未完成

- 目前没有真实卖单提交端，也没有订单 ID 生成与绑定流程。
- 没有 `syncSellOrderFromBinance` 调度器；卖出事件的 exchangeOrderId 尚无安全的生产写入来源。
- SELL 成交写入统一台账后，卖出事件状态尚未在同一事务中更新（两个模块目前使用不同 IndexedDB 数据库）。
- 没有实现持仓成本分摊、周期仓/底仓剩余数量和实现盈亏。
- 自动卖出仍然关闭；不会发送 Binance 订单 POST。

## 安全边界

只有通过 Binance 只读订单快照与逐笔成交完整核对的 SELL fills 才能调用入账函数。第三资产手续费无法可靠换算时，整个订单的自动记账必须暂停，不能只记录净额或忽略手续费。
