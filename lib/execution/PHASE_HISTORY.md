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


---

<!-- 原文件：lib/execution/PHASE_10.md -->

# 第十阶段：卖出订单只读对账

## 已完成

1. 新增 Binance 现货订单 ID 查询 `fetchSpotOrderById`，只读 GET。
2. 新增卖出事件订单 ID 绑定函数，校验数字 ID，且一旦绑定不可替换。
3. 新增 `syncSellOrderFromBinance`：
   - 读取已绑定事件；
   - 按交易对和 Binance 订单 ID 读取订单快照；
   - 根据订单状态判断等待、部分成交、完成或人工复核；
   - 拉取该订单的逐笔成交；
   - 校验 SELL 方向、成交明细与订单累计数量/金额；
   - 原子写入成交唯一键、成交台账、邮件 Outbox；
   - 更新卖出事件已核对的成交 ID 和真实累计成交量。
4. 增加 `partially_filled` 终态，避免把撤单后部分成交错误记成全量执行。
5. 指标止盈的累计量在终态部分成交时使用实际成交数量。
6. 增加终态部分成交额度与重复止盈事件保护测试。

## 安全限制

- 不存在 Binance 下单 POST、撤单、自动重试。
- 目前没有生产卖单提交器，所以没有自动来源能为事件绑定真实订单 ID。
- 只有外部执行器在收到 Binance 成功订单响应后，才能调用绑定函数。
- 订单 ID 不存在、查询失败、成交数据不一致、第三资产手续费无法估值时，流程停止并保留复核状态。
- 事件状态和成交台账分属两个 IndexedDB 数据库；跨库事务无法保证原子性。若成交已入账而事件更新失败，重复对账会通过成交 ID 去重后重试状态更新。

## 下一阶段

- 审查并统一持仓账本：FIFO/加权成本规则、基础币手续费净数量、卖出手续费、周期仓/底仓拆分、已实现盈亏。
- 在自动卖出设计前，完成卖出订单提交的幂等 ID、超时查询、重复 POST 防护与本地订单状态机审查。
- 继续保持 DRY_RUN，不请求 Binance 交易权限。


---

<!-- 原文件：lib/execution/PHASE_11.md -->

# 第十一阶段：加权平均持仓账本回放

## 目标

从交易所已确认成交记录重建每个资产的长期底仓、周期仓、成本、均价与实现盈亏，为后续卖出预检提供可核验的本地数据来源。

## 已完成

- 新增 position-accounting.ts，按成交时间顺序回放 BUY/SELL，使用加权平均成本法。
- BUY fill 根据 V3.3 底仓比例拆分长期底仓与周期仓。
- 普通止盈、指标止盈、追踪止损只能减少周期仓；底仓减仓只减少长期底仓。
- BUY 基础币手续费：净买入数量扣除手续费，不重复加成本。
- BUY USDT/第三资产手续费：计入成本。
- SELL 基础币手续费：增加被处置数量，不再从 quote proceeds 重复扣手续费。
- SELL USDT/第三资产手续费：从净卖出收入扣除。
- 计算每笔卖出时的平均成本、成本移除额与累计实现盈亏。
- TradeLedgerEntry.sellKind 持久化卖出事件类别；卖出同步传入事件类别。
- 新增 getReconciledPositionFromLedger，读取本地成交台账并重建单币快照。
- 新增 fetchSpotAssetBalance 和 getSellPositionSnapshotFromBinance，读取 Binance free/locked，并要求交易所总持仓与本地台账数量一致，否则拒绝输出卖出预检快照。
- 新增 prepareQueuedSellDryRunFromBinance，只有本地成交账本和 Binance free/locked 对账一致后才进入只读卖出预检；新增集成测试覆盖成功路径与数量不一致阻断。
- 测试覆盖买卖费用、底仓/周期仓边界和异常成交数据。

## 当前计算口径

- BUY 基础币手续费：netQty = qty - commission，cost = quoteQty。
- BUY 报价币/第三资产手续费：netQty = qty，cost = quoteQty + commissionUsdt。
- SELL 基础币手续费：disposedQty = qty + commission，proceeds = quoteQty。
- SELL 报价币/第三资产手续费：disposedQty = qty，proceeds = quoteQty - commissionUsdt。
- 卖出实现盈亏：netProceeds - averageCost × disposedQty。

## 安全限制

- 本地回放只代表已核验成交；getSellPositionSnapshotFromBinance 会额外与 Binance free/locked 总量核对，二者不一致就拒绝提供卖出预检快照。
- 手动交易、转入/转出、其他设备交易或遗漏历史成交会造成台账与交易所余额差异。
- 当前底仓比例从 V3.3 配置读取；将来若改变比例，必须保存历史策略参数或做显式迁移。
- 已接入只读 DRY_RUN 卖出预检；仍然没有任何真实下单调用。
- 未确认成交、第三资产手续费未可靠估值或超过仓位的卖出，必须暂停并人工复核。
- 不包含订单提交、撤单、自动重试；实盘保持关闭。


---

<!-- 原文件：lib/execution/PHASE_12.md -->

# 第十二阶段：买入历史参数固化

## 目标

让每笔买入使用其产生时的策略参数拆分底仓/周期仓，禁止未来策略参数变化重算历史仓位。

## 已完成

- 新买入信号入队时写入 `baseRatioAtSignal`，核心资产按当时配置取积极型比例，其他资产取保守型比例。
- 买入队列创建时验证比例在 [0, 1] 范围内。
- 已确认 BUY fill 入账时从对应队列订单读取冻结比例，并将 `baseRatioAtBuy` 保存到 TradeLedgerEntry。
- 同一待买订单多次部分成交都使用相同冻结比例。
- 持仓账本逐笔读取 `baseRatioAtBuy`，不再依赖当前策略配置。
- 对缺少历史比例的旧待买订单拒绝新成交入账；旧成交记录缺参时拒绝持仓回放。
- 测试覆盖 40%/20% profile、混合历史比例回放、无效比例和旧记录缺参阻断。
- 修正基础币手续费的 USDT 支出口径：基础币手续费只减少/增加净持仓数量，不再重复计入 USDT 成本或收入费用；USDT 手续费仍按 quote 金额处理，第三资产手续费仍拒绝自动入账。

## 兼容与迁移

- 不需要升级 IndexedDB store schema；新增字段随记录写入。
- 已有 IndexedDB 记录不会自动补字段或被删除。
- 对于旧成交台账，不能仅凭当前配置推断历史底仓比例。需先核对成交发生时的策略版本/参数，再制定显式迁移；在此之前卖出预检保持阻断。
- 旧待买队列订单如果没有 `baseRatioAtSignal`，其后续成交入账将失败并进入人工复核流程，避免静默套用新比例。

## 当前安全边界

- 仍然没有 Binance 下单 POST、撤单或自动重试。
- 本阶段不请求交易权限，不会产生真实交易。
- 新字段只记录买入拆分比例；后续仍需固化其他影响仓位分类/成本计算的策略参数，并完善手动转入转出核对。


---

<!-- 原文件：lib/execution/PHASE_13.md -->

# 第十三阶段：持仓差异诊断报告（只读）

## 目标

当本地已确认成交台账与 Binance 现货余额不一致时，向用户展示明确的差异方向和数量，而不是只返回一个笼统异常；同时保持自动卖出 fail-closed。

## 已完成

- 新增 `buildPositionReconciliationReport`，分类：
  - `matched`：本地台账与交易所总持仓在容差内一致。
  - `exchange_higher`：交易所持仓高于本地台账，可能是外部转入、漏同步成交或其他账户操作。
  - `ledger_higher`：本地台账高于交易所持仓，可能是转出、手动卖出或未同步账户变化。
  - `exchange_components_invalid`：Binance free + locked 与 total 自身不一致。
- 报告包含 ledger、free、locked、total、delta、tolerance、canSell 和解释文本。
- 新增 `getPositionReconciliationReportFromBinance`，整合本地成交回放和 Binance 只读余额。
- 新增测试覆盖四种状态。

## 安全边界

- 不自动把余额差额当作买入、卖出或转账。
- 不自动调整成本、底仓、周期仓或成交台账。
- 诊断报告不是卖出授权；卖出预检继续使用原有严格核对函数。
- 只有数量匹配时报告才返回 `canSell=true`，但这仍不代表交易已获授权或真实下单已启用。
- 仍无 Binance 下单 POST；实盘保持关闭。


---

<!-- 原文件：lib/execution/PHASE_14.md -->

# 第十四阶段：Spot 优先、Simple Earn 活期补足（资金调度规划）

## 用户确认的资金策略

- 闲置 USDT 留在 Simple Earn Flexible 赚取利息。
- 买入时优先使用 Spot USDT。
- Spot 不足时只赎回 Simple Earn Flexible 的差额。
- 不自动赎回 Locked Earn。
- Spot + Flexible Earn 仍不足时，保留未满足金额在待买队列，不扩大额度、不挪用其他资产。

## 本阶段代码

- `wallet-funds.ts`：Spot 优先资金分配纯函数。
- `earn-redemption.ts`：按 Flexible 产品 productId 分配赎回金额、创建稳定幂等意图、限制状态迁移、处理超时复核和到账核验。
- `earn-redemption.browser.ts`：读取 Spot、Flexible 持仓和本地预留，先原子预留本订单的 Spot 份额，再为缺口生成赎回计划；已有活动意图直接复用，不重复生成。
- 新增 `submitPlannedEarnRedemption`：重新读取指定 productId 的可赎回余额，原子领取 planned 意图后才允许进入一次 POST；并发标签页不能重复领取。
- 新增 `redeemFlexibleEarnUsdt`：实现 Binance Flexible redeem POST，固定 `destAccount=SPOT`、精确 productId 和金额；`LIVE_EARN_REDEMPTION_ENABLED=false`，默认 fail-closed，不会发送请求。
- POST 返回 redeemId 后持久化；超时、响应异常或本地保存异常均转入 `reconcile_required`，禁止自动重发。
- 若 POST 成功但浏览器未能保存 redeemId，可按 productId + USDT + 精确金额 + SPOT 目的账户查询历史；只有唯一匹配才恢复 redeemId，多条或零条匹配均人工复核。
- 赎回到账后，只有通过 redemption history + Spot free 基线核验，才扩展该订单的本地 Spot 预留；普通预览不会扩大预留。
- `store.browser.ts`：IndexedDB 升级到 v4，新增 `earn-redemption-intents`，以事务方式保存赎回意图和状态。
- `binance.browser.ts`：按 Binance 实际返回字段读取 Flexible 持仓（`totalAmount`、`productId`、`canRedeem`、`collateralAmount`），归一化后保留 productId；Locked 持仓按 `amount` / `redeemingAmt` 读取；另有只读赎回历史查询。
- 不再把现货账户的 `LDUSDT` / `LD...` 代码猜测性地转换为基础资产；Simple Earn 持仓以专用 position API 为准。
- `BuyQueue.tsx`：新增“资金来源规划”，展示现货使用、活期计划赎回和未满足金额。
- 新增测试覆盖多产品拆分、同一产品重复意图、跨订单本地预留、超时转复核、赎回历史匹配和 Spot 到账确认。

## 资金计划规则

1. Spot free 先扣除其他买单的活动本地预留。
2. Spot 可用金额优先覆盖本次待买金额。
3. 只对差额分配 Flexible Earn USDT。
4. 分配按具体 productId 进行，并扣除交易所冻结、赎回中和其他订单本地赎回预留。
5. Locked Earn 永远不进入自动赎回分配。
6. 活期余额不足时返回未满足金额，不能扩大本次计划金额。

## 赎回幂等与恢复

- 每个买单 + Flexible productId 生成稳定意图 ID；重复刷新复用已有意图。
- 状态流转：planned → submitting → submitted → redeeming → credited。
- 请求超时或响应不明确时转 `reconcile_required`，不允许盲目重复提交。
- 赎回历史优先匹配确切的 Binance redemptionId、USDT、金额和 SPOT 目的账户；丢失 redemptionId 时仅允许按 productId + 金额等字段唯一恢复。
- 只有赎回历史核实且 Spot free 相对赎回前基线增加足额，才标记 credited。
- 无 redemptionId、历史记录不唯一、金额不匹配或余额未到账时，转人工复核/继续等待，不允许启动买单。

## 当前执行边界（非常重要）

- 当前 `LIVE_EARN_REDEMPTION_ENABLED=false`，虽然已实现 POST 适配器和单次提交/失败复核流程，但所有入口仍 fail-closed，不会调用 Binance redeem POST；也没有 Spot order POST。
- 当前用户 API Key 仍为只读，不能执行赎回。Binance 官方将 Flexible redeem 定义为 `POST /sapi/v1/simple-earn/flexible/redeem`，权限分类为 `TRADE`；赎回历史是 GET USER_DATA。参考：[Binance Simple Earn API](https://developers.binance.com/en/docs/catalog/investment-and-services-simple-earn/api/rest-api/flexible-locked)。
- 用户选择私人自用的浏览器直连模式，并接受 API Secret 会进入前端 bundle 的风险。该方案不是安全隔离：只能使用专用 Key、绑定固定 IP、禁止提现/划转/合约权限，不可把 Key/Secret 写入源码或提交 Git；若不能绑定 IP，不应开启交易权限。
- 启用前仍需用户明确确认、换用专用 TRADE Key，并在 Binance Testnet/小额受控环境完成验证；当前不会要求用户现在开启权限。
- IndexedDB 是本浏览器本地状态；清除站点数据会丢失赎回意图。不能把本地意图当作 Binance 已赎回的事实。
