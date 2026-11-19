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


---

<!-- 原文件：lib/execution/PHASE_15.md -->

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
- BUY 已有单次提交编排；SELL 的完整提交编排和页面打开期间的自动只读对账已在第十六阶段补齐。Spot Testnet 端到端测试仍未完成。
- 本地 IndexedDB 预留不是 Binance 侧锁仓；最终执行前仍必须重新读取 Spot free 和交易对规则。


---

<!-- 原文件：lib/execution/PHASE_16.md -->

# 第十六阶段：卖出提交编排与自动只读对账

## 本阶段实现

- 新增 `sell-order-submit.browser.ts`，将卖出事件、交易规则、实时价格、持仓账本和 Binance Spot SELL 接口串联。
- 提交前重新读取 Binance 交易对规则和价格，并通过本地成交台账与 Binance free/locked 持仓核对。
- 普通止盈、指标止盈、追踪止损只能卖周期仓；底仓减仓沿用单次最多减去受保护底仓 50% 的约束。
- `fundamental_exit` 暂不允许自动执行，必须人工复核。
- 提交前先在 IndexedDB 原子领取卖出事件并保存确定性 `clientOrderId`；多个标签页不能重复领取。
- POST 成功后绑定 Binance `orderId`；如果响应或本地绑定异常，保留 `clientOrderId`，后续可通过只读订单查询恢复。
- 新增卖出数量格式化函数和测试，使用已通过交易步长预检的数量，不自行扩大数量。
- `SellQueue` 新增执行卖出入口，但实盘开关关闭时不可用。
- 买卖队列页面每 30 秒自动核对已经领取、处于 `reconcile_required` 的订单；仅调用只读订单和成交查询，不会重复 POST。
- 自动对账和人工对账共用页面内的 in-flight 锁，避免同一订单并发查询和重复写入。

## 自动对账规则

1. 只处理已有本地提交 attempt / clientOrderId 的订单。
2. 先按 clientOrderId 或 exchangeOrderId 查询原订单。
3. 订单未终态时继续保留锁定状态，等待下一轮对账。
4. 只有逐笔成交与 Binance 累计成交数量、金额一致时才记入成交台账。
5. 成交台账按交易所成交 ID 去重；成交 Outbox 只在确认成交入账时创建。
6. 已终态部分成交按实际成交量记账，不根据原始请求量推断成交。
7. 不存在订单、查询失败或数据不一致时保持复核状态，不自动重发 POST。

## 运行边界

- 自动轮询只在看板页面打开时运行；页面关闭期间不会执行轮询。
- BUY、SELL、Simple Earn redeem 的实盘开关均保持 `false`。
- 当前只完成浏览器打开期间的自动只读对账，不代表后台常驻任务。
- SELL MARKET POST 编排已实现但未启用；基本面失效退出尚未纳入自动执行。
- 没有部署或使用 Binance 交易权限；当前只读 Key 不会因此获得交易能力。
- 成交通知 Outbox 已在真实成交核验后入队，但安全的登录态转发/邮件 dispatcher 尚未接通。


---

<!-- 原文件：lib/execution/PHASE_17.md -->

# 第十七阶段：成交邮件 Outbox 安全投递

## 本阶段实现

- 扩展成交通知 Outbox 状态：`pending / sending / sent / failed`。
- 新增 2 分钟租约，使用同一 IndexedDB readwrite transaction 批量领取，防止同一浏览器多个标签页重复投递。
- 浏览器崩溃后租约到期可恢复；投递失败按指数退避，最长间隔 1 小时。
- 新增 `notification-dispatch.browser.ts`，只把已核验成交事件的必要字段提交给同源 API。
- 新增 `app/api/trade-fill-notifications/route.ts`：
  - 校验精确 `APP_ORIGIN`
  - 验证 Cloudflare Access JWT 签名、issuer、audience、有效期和可选邮箱白名单
  - 校验成交事件字段和批次幂等 ID
  - 使用仅存在于服务端环境变量的 HMAC Secret 签名
  - 将请求转发到成交邮件 Worker
- `ExecutionBackground` 在页面打开且标签页可见时，每 30 秒运行买卖只读对账及 Outbox 投递。
- Worker 只有确认接收整个批次（accepted + duplicate = batch size）后，浏览器才把事件标记为 sent。

## 需要部署者配置

看板服务端环境变量：
- `APP_ORIGIN`
- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`
- `CF_ACCESS_ALLOWED_EMAIL`（必填，唯一允许邮箱白名单）
- `TRADE_FILL_NOTIFY_URL`
- `TRADE_NOTIFY_HMAC_SECRET`

Cloudflare Worker：
- KV namespace `TRADE_FILL_NOTIFICATIONS`
- Secret `TRADE_NOTIFY_HMAC_SECRET`（必须与看板服务端相同）
- Secret `RESEND_API_KEY`
- Variables `MAIL_FROM`、`MAIL_TO`

部署步骤见 `workers/TRADE_FILL_EMAIL_SETUP.md`。

## 安全边界

- 所有环境变量都不使用 `NEXT_PUBLIC_` 前缀。
- HMAC Secret 和 Resend API Key 不进入浏览器 bundle。
- API 未配置 Access、Origin 或 HMAC 时 fail-closed。
- 浏览器 Outbox 只能来自本地成交核验流程，但本机用户仍能修改浏览器状态；邮件是私人提醒，不是独立审计证明。
- Cloudflare KV 为最终一致性存储；Worker 的 Resend Idempotency-Key 和本地租约降低重复投递风险，但不承诺跨设备严格 exactly-once。
- 页面关闭时不会运行自动 dispatcher；重新打开页面后恢复。
- 邮件投递不需要 Binance TRADE 权限，也不执行任何交易。


---

<!-- 原文件：lib/execution/PHASE_18.md -->

# 第十八阶段：自动执行周期（实盘开关默认关闭）

## 本阶段实现

- 将 `ExecutionBackground` 提升为 Dashboard 根级组件；无论用户当前是否打开“待买队列”Tab，只要看板打开且标签页可见，后台周期都会运行。
- 每 30 秒进行一次买卖订单只读对账和成交 Outbox 投递；行情刷新后使用最新 DashboardData。
- 增加 gated execution cycle：
  - 仅在数据源为 Binance、数据非 stale、账户状态已知时进入执行分支。
  - BUY：读取币种当前累计成本，按策略 profile 固定成本上限计算剩余额度；先做 Spot 预检，再使用单次提交编排。
  - Simple Earn：只有 `LIVE_EARN_REDEMPTION_ENABLED` 开启时，才规划/提交 USDT Flexible Earn 缺口赎回；赎回历史和 Spot 到账核实后，后续周期再执行买入。
  - SELL：只允许止盈、指标止盈、追踪止损和受限底仓减仓事件；基本面退出不自动执行。
  - 每个周期最多提交一个买入订单和一个卖出订单；Flexible Earn 多产品赎回按已持久化 intent 逐个处理。
- 自动执行与只读对账分离；订单提交前仍需经过独立的最新余额/规则/仓位预检、IndexedDB 原子领取和确定性 clientOrderId。
- in-flight guard 跨 Dashboard 行情刷新保持，避免 effect 重建时重复处理同一事件。

## 重要安全约束

- `LIVE_SPOT_ORDER_SUBMISSION_ENABLED=false`
- `LIVE_SPOT_SELL_SUBMISSION_ENABLED=false`
- `LIVE_EARN_REDEMPTION_ENABLED=false`

以上三个开关均保持关闭。当前自动执行周期只会执行只读对账和已确认成交邮件投递，不会真实买入、卖出或赎回。

## 运行边界

- 自动周期依赖看板保持打开且标签页可见；浏览器关闭或设备休眠时不会运行。
- 当前仍未完成 Binance Spot Testnet 端到端演练。
- 自动申购 Simple Earn Flexible 尚未实现；只实现了买入缺口时的活期赎回规划/受控适配器。
- Locked Earn 不进入自动资金调度。
- 需要启用实盘前，必须完成测试网演练、密钥安全审查和用户明确确认。


---

<!-- 原文件：lib/execution/PHASE_19.md -->

# 第十九阶段：Binance Spot Testnet 环境隔离

## 本阶段完成

- 新增 `lib/binance-environment.ts`，集中解析 Spot API 环境。
- 默认生产环境使用 `https://api.binance.com` 和原生产凭证入口。
- 只有显式设置 `NEXT_PUBLIC_BINANCE_SPOT_TESTNET=1` 才切换到 `https://testnet.binance.vision`。
- Testnet 模式只读取 `NEXT_PUBLIC_BINANCE_TESTNET_API_KEY` / `NEXT_PUBLIC_BINANCE_TESTNET_API_SECRET`，绝不回退生产 Key、Secret 或源码 fallback。
- Spot 账户、交易对过滤器、订单查询、逐笔成交和 Spot 公共行情随 BASE 切换到 Testnet。
- Testnet 模式对 Simple Earn 持仓、历史和赎回路径 fail-closed；不会请求生产 `/sapi/v1/simple-earn/*`。
- 新增纯函数测试覆盖环境选择、凭证隔离、生产提交开关保持关闭、Simple Earn Testnet 拒绝。
- README 增加独立 Testnet 环境配置步骤。

## 尚未完成

- Testnet 的 BUY/SELL 提交 UI 与自动执行调度尚未接入 Testnet 专用开关；队列按钮仍按生产实盘开关禁用。
- 当前不能把本阶段描述为完成了 Testnet 真实下单演练。
- 还没有用户自己的 Testnet API Key，也没有运行真实 Testnet 下单、撤单/终态、部分成交和超时恢复演练。
- Simple Earn 不在 Spot Testnet 的支持范围内，仍需用模拟数据验证资金调度，不可拿生产账户测试。

## 安全边界

- `LIVE_SPOT_ORDER_SUBMISSION_ENABLED=false`
- `LIVE_SPOT_SELL_SUBMISSION_ENABLED=false`
- `LIVE_EARN_REDEMPTION_ENABLED=false`
- 生产环境提交开关不会被 Testnet 环境变量打开。
- Testnet Key/Secret 与生产凭证严格分离；缺少 Testnet 凭证时不会使用生产凭证兜底。
- 真实账户资金和现有只读 API Key 未被使用；本阶段未发送任何交易或赎回 POST。

## Testnet 环境变量

```dotenv
NEXT_PUBLIC_DIRECT_BINANCE=1
NEXT_PUBLIC_BINANCE_SPOT_TESTNET=1
NEXT_PUBLIC_BINANCE_TESTNET_API_KEY=your_testnet_key
NEXT_PUBLIC_BINANCE_TESTNET_API_SECRET=your_testnet_secret
```


---

<!-- 原文件：lib/execution/PHASE_20.md -->

# 第二十阶段：Binance 服务端密钥隔离与只读代理

## 已完成

- .env 和 .env.production 已从当前分支删除；新增无密钥 .env.example。
- .gitignore 忽略 .env、.env.*，仅允许跟踪 .env.example。
- Dashboard 不再根据 NEXT_PUBLIC_DIRECT_BINANCE 切换到浏览器直连，数据读取统一走 /api/dashboard。
- lib/binance.ts 只从服务端 process.env 读取凭证。
- 新增 resolveServerBinanceEnvironment：
  - BINANCE_SPOT_ENVIRONMENT=testnet 时固定使用 https://testnet.binance.vision 和 BINANCE_TESTNET_API_KEY/SECRET。
  - 其他模式只使用 BINANCE_API_KEY/SECRET。
  - Testnet 不回退生产凭证，也不接受生产自定义 endpoint。
- 浏览器端 lib/binance.browser.ts 不再读取 NEXT_PUBLIC_* Key/Secret，私密签名 GET 通过同源 /api/binance/signed-read 代理。
- 服务端 signed-read endpoint 采用 endpoint + query 参数 allowlist；只允许只读账户、订单查询、成交查询、交易对信息及 Simple Earn 读取路径。
- Testnet 模式在服务端拒绝所有 Simple Earn SAPI 路径。
- BUY/SELL POST 仍然关闭；没有通过此代理开放任何交易或赎回 POST。
- 增加服务端环境选择与 signed-read allowlist 单元测试。

## 当前未完成

- BUY/SELL 下单 POST 尚未迁移为服务端专用执行 API。
- 队列按钮和自动执行调度尚未接入测试网专用开关。
- 当前不能从 UI 提交测试网订单。
- 尚未运行真实 Spot Testnet 下单、订单查询、逐笔成交、部分成交和超时恢复演练。
- Simple Earn 在 Testnet 不可用，资金调度仍需 Mock 验证。

## 本地配置

复制 .env.example 为 .env.local，密钥只填写在本地文件，不要提交到 GitHub：

- 测试网：BINANCE_SPOT_ENVIRONMENT=testnet，填写 BINANCE_TESTNET_API_KEY/SECRET，并设置非秘密的 NEXT_PUBLIC_BINANCE_SPOT_TESTNET=1。
- 生产：BINANCE_SPOT_ENVIRONMENT=production，填写 BINANCE_API_KEY/SECRET，并移除或设为 NEXT_PUBLIC_BINANCE_SPOT_TESTNET=0。

## 安全边界

- 所有 API Secret 仅存在服务端运行环境。
- 浏览器只知道环境模式，不持有任何 Key/Secret。
- 生产 BUY/SELL 与 Earn redemption 均保持关闭。
- 本阶段没有发送任何交易或赎回 POST。


---

<!-- 原文件：lib/execution/PHASE_21.md -->

# 第二十一阶段：Spot Testnet BUY / SELL 服务端提交

## 已完成

- 新增 POST /api/binance/testnet-order。
- 服务端只接受 BUY / SELL、symbol、amount、clientOrderId 四个字段；拒绝额外字段。
- 强制同源 Origin、JSON content-type、请求体大小限制。
- 要求设置 DASHBOARD_PASSWORD；未配置时订单接口 fail closed。
- 服务端固定 Testnet endpoint，只读取 BINANCE_TESTNET_API_KEY/SECRET。
- 服务端分别检查 BINANCE_TESTNET_BUY_ENABLED / BINANCE_TESTNET_SELL_ENABLED。
- 浏览器只允许通过同源 API 请求订单；不再自行 HMAC 签名或接触 Secret。
- 前端分别使用 NEXT_PUBLIC_BINANCE_TESTNET_BUY_ENABLED / SELL_ENABLED 展示测试网按钮。
- 买入/卖出队列执行器和后台自动调度接入测试网开关。
- 生产环境服务端执行器硬拒绝，前端生产环境开关也始终为 false。
- 新增纯函数测试，验证服务端 BUY/SELL 开关隔离。

## 本地启用顺序

1. 复制 .env.example 为 .env.local。
2. 设置 BINANCE_SPOT_ENVIRONMENT=testnet 与 NEXT_PUBLIC_BINANCE_SPOT_TESTNET=1。
3. 填写独立 Testnet Key/Secret。
4. 设置 DASHBOARD_PASSWORD。
5. 先只开启 BUY 的前后端两个开关；完成买入与对账验证后，再考虑单独开启 SELL。
6. 不要把 .env.local 提交到 GitHub。

## 尚未完成

- 尚未使用用户本地 Testnet Key 发出真实 Testnet 订单。
- 尚未完成真实部分成交、超时、网络中断后的 clientOrderId 恢复演练。
- 尚未验证不同 Testnet 交易对的精度、最小名义金额和流动性差异。
- Simple Earn 不支持 Spot Testnet，相关资金调度继续使用 Mock。
- 需要在本地运行 build 和完整测试；GitHub Actions 结果以本阶段提交对应的最新 run 为准。

## 资金与权限边界

- 这里只能路由到 Binance Spot Testnet，不会调用生产订单 endpoint。
- 没有增加提现、划转、合约或 Earn 赎回接口。
- 生产 BUY/SELL 与 Earn 赎回仍关闭。
- 真实账户资金不参与本阶段。


## 第二十二阶段安全加固补充

- 订单 API 不再只检查 DASHBOARD_PASSWORD 是否存在；接口内部也验证 Basic Auth 密码。
- Basic Auth 比较使用固定时间循环，避免普通字符串直接比较。
- 请求体改为读取原始文本后按 UTF-8 字节数限制，不能依赖客户端可伪造/省略的 Content-Length。
- 严格拒绝跨源请求、非 JSON、无效 JSON、超大请求体和未声明字段。
- BINANCE_SPOT_ENVIRONMENT 显式填写了非 testnet/production 的值时直接拒绝，不会因拼写错误静默回退生产环境。
- API route security tests 已纳入 Vitest include，确保 CI 实际执行路由测试。

认证说明：浏览器必须先通过全站 Basic Auth；订单 API 自身再次核对相同密码。部署时必须设置强 DASHBOARD_PASSWORD，并使用 HTTPS。


---

<!-- 原文件：lib/execution/PHASE_27.md -->

# Phase 27 — Monotonic BUY reservation reconciliation

## Scope

This phase hardens local USDT reservation accounting when multiple browser tabs reconcile the same BUY order and when a page is closed or refreshed during an in-flight order.

## Changes

- Added `reconcileBuyFundsReservation` as the single pure transition for applying cumulative exchange-confirmed quote spend plus USDT-equivalent commission.
- Rejects cumulative spend snapshots older than the amount already persisted. This prevents an older tab from restoring previously consumed reservation capacity.
- Rejects non-terminal snapshots attempting to reactivate a reservation released after a confirmed terminal order state.
- Keeps a reservation in `active` state while the exchange order is still open, even when its remaining reserved amount reaches zero. A fill alone is not proof of terminal order status.
- Uses the same transition from both atomic fill recording and later cumulative order reconciliation.
- Added tests for cumulative partial spend, out-of-order snapshots, zero remaining reservation on an open order, terminal release, and idempotent terminal refresh.

## Cross-tab and recovery behavior

- `reserveBuyFunds` uses an IndexedDB `readwrite` transaction over the reservation store. Concurrent tabs therefore serialize allocation against the shared local reservation list.
- Repeated reservation attempts for the same order reuse its active reservation rather than allocating it twice.
- `claimBuyOrderSubmission` separately uses an atomic order-store transaction. Only one tab can move a given pending order into `reconcile_required` and claim the attempt; other tabs are rejected.
- Submitted or ambiguous attempts remain persisted as `reconcile_required`. When the dashboard is mounted again, `ExecutionBackground` scans these records immediately and every 30 seconds and resumes read-only Binance reconciliation.
- An ambiguous POST is not automatically resent. Recovery uses the persisted attempt number and deterministic `clientOrderId`.

## Important limitations

- IndexedDB coordination applies only to tabs sharing the same browser origin and browser profile. It is not a server-side or exchange-side balance lock and does not coordinate separate devices or browser profiles.
- Closing a tab preserves IndexedDB state, but reconciliation only resumes after the dashboard is opened again; there is no background service running while the browser is fully closed.
- Clearing browser site data can erase the local queue and reservation records. The exchange remains authoritative; do not infer that a missing local record means an order was never submitted.
- Automated tests validate the pure reservation transition and TypeScript build. They do not constitute a real multi-tab browser test or a real Binance Testnet order test.
- Production order submission and Earn redemption remain disabled.

## Validation

Latest GitHub Actions run for this phase:
- 36 test files passed
- 271 tests passed
- TypeScript typecheck passed


---

<!-- 原文件：lib/execution/PHASE_28.md -->

# Phase 28 — Sequential take-profit and post-TP average-cost rebuy

## User-confirmed rules

- Long-term base inventory is protected; ordinary take-profit operates on cycle inventory.
- TP tiers are sequential and each tier is once-only:
  - 2x current average cost: sell 50% of current cycle inventory.
  - 3x current average cost, only after tier 1 has confirmed fills: sell 30% of then-current cycle inventory.
  - 5x current average cost, only after tier 2 has confirmed fills: sell 80% of then-current cycle inventory.
- A partial terminal fill counts as that tier having executed; actual fills, not requested quantity, are recorded.
- After any confirmed take-profit fill in the current holding round, disable the old head-price add ladder and reserve tier.
- Rebuy from current average cost, beginning again at add tier 1. Core drops remain 15/30/45/60%; conservative drops remain 30/50/65/80%; amounts reuse the corresponding profile add amounts.
- Each rebuy tier is counted once per exchange order. A fully closed position ends the round; the next holding round returns to normal head-order rules.
- Rebuy remains subject to score, stabilization, cooldown, market-state and per-asset cost-cap constraints.

## Implementation

- Updated both profile take-profit arrays to 2x/3x/5x with 50%/30%/80%.
- Changed the strategy engine to calculate each TP fraction from the currently remaining cycle quantity.
- Added `strategy/post-take-profit-rebuy.ts`, which hydrates server-computed signals using confirmed SELL events and the browser's exchange-confirmed execution ledger.
- TP tier state is inferred only from confirmed `take_profit` sell events with recorded fill IDs; pending events do not switch the strategy to post-TP mode.
- TP events are strictly sequential. A price jump directly to 5x cannot skip the 2x and 3x tiers.
- The post-TP rebuy ladder uses the replayed remaining average cost and counts distinct BUY order IDs after the first TP fill, so multiple partial fills of one order do not consume several rebuy tiers.
- Replays BUY costs and SELL quantities from dashboard buys plus local confirmed SELL fills. Base-asset commissions are included in disposed quantity.
- If TP history is present but fill details are missing, or replayed quantity does not match current holdings, rebuy is blocked rather than falling back to the old head-price ladder.
- If the replay reaches zero holdings before a later new buy, the new position is treated as a new round.
- Dashboard strategy queue creation runs after local sell history is loaded and applied.

## Persistence boundary and limitations

- Confirmed sell-kind history and execution fills currently live in browser IndexedDB. They are not synchronized across devices or browser profiles.
- Clearing site data can erase this history. If TP history cannot be reconciled with its fills and current balance, the strategy blocks the post-TP rebuy path.
- External/manual trades that are not represented in the local ledger may cause a quantity mismatch; this is intentionally fail-closed.
- The server-generated signal can be briefly visible before the browser hydrates local IndexedDB on first load; execution queue creation is gated on the fresh dashboard state and then uses the hydrated state.
- No real order was submitted in this phase. Live production trading remains disabled.

## Validation

- 37 test files passed.
- 280 tests passed.
- TypeScript typecheck passed.
- GitHub Actions: https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44474179915


---

<!-- 原文件：lib/execution/PHASE_29.md -->

# Phase 29 — BUY attempt fencing and duplicate-fill integrity

## Changes

### 1. Fence every asynchronous state write by attempt ID

- All error and partial-fill state writes in `sync-buy-order.browser.ts` now pass the attempt number that initiated the reconciliation.
- Successful and ambiguous POST outcomes in `buy-order-submit.browser.ts` also pass the claimed attempt number.
- If an older browser tab finishes late after another tab has reconciled the order or claimed a newer attempt, its state write is rejected by the IndexedDB transaction guard.
- This closes a race where an old partial snapshot or delayed POST callback could put a newer attempt back into `reconcile_required`.

### 2. Verify duplicate BUY fills against persisted facts

- `recordConfirmedBuyFill` now reads the unique fill index and trade ledger in the same readwrite transaction.
- A duplicate fill is accepted only if both the fill index and ledger row exist and every immutable execution field matches.
- A duplicate ID with changed quantity, price, quote amount, commission, asset, side, order ID or timestamp is rejected.
- A fill index without a ledger row, or a ledger row without a fill index, now fails closed.
- Duplicate BUY reconciliation no longer silently trusts the newest response payload.

### 3. Tests

- Added `sync-buy-order.browser.test.ts` to verify:
  - partial orders remain locked;
  - fill-ledger failures carry the originating attempt;
  - reservation-reconciliation failures carry the originating attempt.
- Existing tests cover conflicting duplicate fill payloads and monotonic reservation spend.

## Safety boundary

- Production BUY/SELL switches remain disabled.
- Simple Earn redemption remains disabled.
- No real order was submitted.
- These changes improve local browser-tab concurrency and ledger integrity; IndexedDB is still local to a browser profile and does not lock funds on Binance.
- A timeout or missing order lookup remains in reconciliation/manual review. The system does not blindly resubmit an ambiguous order.

## Validation

- 38 test files passed.
- 284 tests passed.
- TypeScript typecheck passed.
- GitHub Actions: https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44475066618
