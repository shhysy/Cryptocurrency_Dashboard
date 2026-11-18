# V3.3 执行层（开发中）

当前统一的策略执行模块位于 `lib/execution/`。当前代码覆盖金额预检、只读成交对账、本地幂等记录，以及默认关闭的 Simple Earn 赎回和 Spot BUY POST 适配器；**现货买卖实盘开关仍关闭；BUY/SELL 提交编排均已实现，但不会发送真实订单**。

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
- `binance-order.browser.ts`：重新读取 USDT free 与交易对过滤器，结合队列剩余金额和单币剩余额度计算本次可预检金额；固定 `DRY_RUN`，绝不提交现货订单。
- `earn-redemption.browser.ts`：已实现单次赎回提交编排、状态领取、POST 结果持久化和超时复核；`LIVE_EARN_REDEMPTION_ENABLED=false`，默认不会发送请求。
- `buy-order-submit.browser.ts`：已实现 Spot MARKET BUY 单次提交编排、资金预留、attempt 原子领取和失败复核；`LIVE_SPOT_ORDER_SUBMISSION_ENABLED=false`，默认不会发送请求。
- `sell-order-submit.browser.ts`：已实现 Spot MARKET SELL 单次提交编排、持仓台账复核、底仓保护和 clientOrderId 恢复；`LIVE_SPOT_SELL_SUBMISSION_ENABLED=false`，默认不会发送请求。
- `notification-dispatch.browser.ts`：通过同源服务端 API 投递已核验成交 Outbox；IndexedDB 租约防止同浏览器标签页重复领取，失败按指数退避。
- `binance.browser.ts`：Simple Earn Flexible redeem POST 适配器固定赎回到 Spot；Spot BUY/SELL POST 适配器均默认关闭，启用前必须有 TRADE 权限。

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

- 撤单、页面关闭后的后台常驻轮询，以及 Spot Testnet 端到端验证。BUY、SELL 和 Simple Earn Flexible redeem POST 均有受控实现但默认关闭，尚未进行真实交易。
- 买入订单自动轮询调度（当前需上层显式调用）；卖出订单已有只读对账函数，但尚无真实卖单提交器与自动轮询调度。
- 卖出信号已完成事件预留、guard 和绑定订单 ID 后的只读成交同步；尚未自动提交卖单。
- 持仓成本、周期仓/底仓数量、实现盈亏已有加权平均成本回放函数；尚未将其接入卖出预检和 UI，也未持久化逐笔已实现盈亏。
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

## 第六阶段：自动卖出预检适配器（DRY_RUN）

- `sell-order.browser.ts`：对已进入待卖队列的事件进行最后一道 Binance 市价卖出预检。
- 必须由调用方提供已对账的持仓快照：现货 free 数量、总持仓数量、受保护底仓数量；不允许仅凭历史买入记录猜测当前持仓。
- 普通止盈、指标止盈、追踪止损只能卖出周期仓；卖出数量受现货 free、周期仓剩余量、交易所数量步长/上下限和最小/最大名义金额约束。
- 只有单独标记的 `base_reduce` 事件可以越过底仓保护线；该事件仍受卖出事件 guard 的单次减仓上限约束。
- `fundamental_exit` 暂未纳入此自动预检入口，避免在基本面退出规则和底仓清仓授权未完成前误触发。
- 结果固定为 `mode=DRY_RUN`、`submitted=false`；任何真实卖单尝试均 fail-closed。
- 新增测试覆盖周期仓卖出、可卖数量裁剪、底仓保护、独立底仓减仓事件及实盘关闭。

本阶段不提交卖单，不改变现有卖出事件状态，也不写入成交台账。真实卖出前仍需真实持仓账本、成交对账、订单幂等和受保护的签名执行端。

## 第七阶段：真实成交邮件 Outbox（本地持久化）

- IndexedDB 数据库升级到 v3，新增 `notification-outbox` store。
- 每一笔通过 Binance 成交明细核验、并成功写入买入成交台账的 BUY fill，会在同一个 IndexedDB readwrite 事务中生成邮件 outbox 事件。
- Outbox 事件 ID 使用 `trade-fill:<symbol>:<exchangeTradeId>`，与成交去重键一致；重复同步同一成交不会再次创建邮件事件。
- 事件仅包含成交方向、交易对、成交数量/价格/金额、手续费、交易所订单 ID 和成交时间，不包含 API Key、Secret、账户总资产或余额。
- `listTradeNotificationOutbox` 可读取待投递事件；投递端确认接收后调用 `markTradeNotificationSent`；失败则调用 `markTradeNotificationFailed`，保留事件供后续重试。
- `notification-outbox.ts` 校验成交事实并构造稳定事件 ID；单元测试覆盖字段校验与幂等 ID。

**当前边界：** 目前只完成“确认买入成交 → 本地 Outbox”的原子链路。邮件 Worker 的成交事件接收接口、可靠投递调度、SELL fill 的对账入账，以及邮件送达回执仍未完成。不能把 Outbox 入队视为邮件已经发送。当前不会因为策略信号或未成交订单发送成交邮件。

## 第八阶段：签名成交邮件接收端（尚未接入前端）

- 新增独立 `workers/trade-fill-email.js`，与旧的卖出信号提醒 Worker 分离；只接受 `confirmed_trade_fill` 买入/卖出成交事件，不接受策略信号。
- Worker 使用 HMAC-SHA256 校验原始请求体 + 毫秒时间戳，拒绝超过 ±5 分钟的请求；签名密钥只应存放在服务端/Worker Secret，不能放入浏览器构建变量。
- Worker 校验成交方向、交易对、成交 ID、订单 ID、数量、价格、成交额、手续费与事件幂等 ID；批量最多 20 条、请求体最多 32 KiB。
- Worker 使用 Resend 发送成交确认邮件，收件人由 Worker 配置固定；邮件发送成功后才写 KV 去重记录，失败不标记已发送。
- 新增 `notification-signature.server.ts`，提供仅服务端使用的 HMAC 签名方法；新增单元测试覆盖签名稳定性、正文变化和参数校验。

**尚未完成：** 当前没有同源 Outbox dispatcher，也没有已验证的用户登录/Cloudflare Access 身份验证。不能只凭 CORS 或 Origin 保护公开 API，因此本阶段没有开放浏览器到 Worker 的投递链路，也没有部署 Worker。正式接入前必须先完成服务端身份验证和转发路由，并确认仅能转发本地 Outbox 事件。

**幂等限制：** KV 是最终一致性存储，普通 KV 的先查后写不是原子锁；Resend Idempotency-Key 可降低重复发送风险，但不能宣称严格 exactly-once。若需要严格的并发事件 claim，应在正式启用前改用 Durable Object。

## 第九阶段：卖出成交核对与原子入账基础

- `fill-reconcile.ts` 新增 `reconcileConfirmedSellFills`：核对 SELL 订单方向、交易对、订单 ID、逐笔成交量/金额与 Binance 累计成交值。
- SELL 手续费为 USDT 或基础币时可确定性换算；BNB 等第三资产手续费仍暂停自动记账，不猜历史汇率。
- 新增 `recordConfirmedSellFill`：在同一个 IndexedDB readwrite 事务内完成 SELL fill 唯一键、成交台账与成交通知 Outbox 写入；不会修改买入队列或买入资金预留。
- 买入和卖出成交共用统一的 `FillReconciliation` 类型；保留旧的 `BuyFillReconciliation` 类型别名以兼容买入同步模块。
- 新增 SELL 成交核对测试和 SELL Outbox 事件测试。

**当前边界：** 这一步只建立 SELL 成交核对与入账基础函数；尚未建立卖单提交、按订单 ID 的卖出同步调度、卖出事件自动完成状态联动，也没有持仓成本/实现盈亏计算。不能将 SELL fill 入账函数视为自动卖出已经完成。

## 第十阶段：卖出订单只读对账

- `lib/binance.browser.ts` 新增 `fetchSpotOrderById`，通过 Binance 只读签名 GET 按交易所订单 ID 查询，不发送订单请求。
- `sell-store.browser.ts` 新增 `bindSellEventToExchangeOrder`，只允许给待处理/复核中的事件绑定数字订单 ID；已绑定 ID 不允许被替换。
- 新增 `sync-sell-order.browser.ts`：读取已绑定的卖出事件，查询 Binance 订单与逐笔成交，核对方向、交易对、订单 ID、成交数量和成交金额，再把确认成交写入统一成交台账及 Outbox。
- 订单仍处于部分成交状态时保留 `reconcile_required`，避免重复创建卖单意图；终态部分成交使用 `partially_filled`，终态全量成交使用 `executed`。
- 事件记录实际累计成交数量 `filledQty`；指标止盈累计量对终态部分成交使用真实成交量，而不是最初请求量。
- 新增测试覆盖终态部分成交的指标止盈额度核算，以及同一止盈档位不重复创建事件。

**重要限制：** 目前仍没有卖单提交器，`bindSellEventToExchangeOrder` 仅供未来在收到 Binance 正常下单响应后绑定订单 ID；当前没有任何调用路径会提交卖单。若订单 ID 未绑定，对账模块会停止并提示复核。该模块不撤单、不重试、不提交 POST。卖出事件库和成交账本仍是两个 IndexedDB 数据库；成交写入成功但事件状态更新失败时，重跑对账会依靠成交 ID 去重，不重复入账或重复创建邮件 Outbox。

## 第十一阶段：加权平均持仓账本回放（只读计算）
- 新增 sell-preflight.browser.ts：先重建本地底仓/周期仓，再读取 Binance free/locked；只有两边总持仓数量一致，才把实际可用数量与受保护底仓传给 DRY_RUN 卖出预检。

- 新增 Binance 现货资产 free/locked 精确读取；getSellPositionSnapshotFromBinance 会将本地台账总数量与 Binance free+locked 总数量严格核对，存在转入/转出、手动交易或漏记时直接拒绝生成卖出预检持仓快照。


- 新增 position-accounting.ts，按成交时间回放已确认 BUY/SELL fills，采用与当前策略成本口径一致的加权平均成本。
- BUY 成交按 V3.3 baseRatio 拆分长期底仓和周期仓；普通止盈/指标止盈/追踪止损只扣周期仓，base_reduce 只扣长期底仓。
- 买入手续费若以基础币扣除，减少净买入数量，不重复增加 USDT 成本；若以 USDT/第三资产扣除，则计入买入成本。
- 卖出手续费若以基础币扣除，增加实际处置数量，不重复从卖出收入扣费；若以 USDT/第三资产扣除，则从净卖出收入扣除。
- 每笔卖出按当时加权平均成本扣减成本，累计计算实现盈亏；超出对应仓位、缺少卖出事件类型或字段异常时拒绝回放。
- TradeLedgerEntry 为 SELL fill 保存 sellKind；卖出同步会把事件类型传入成交台账。
- position-accounting.browser.ts 可从本地成交台账重建单币底仓/周期仓/总数量/成本/均价/累计实现盈亏快照。
- 测试覆盖买入基础币手续费、报价币手续费、普通卖出、底仓减仓、卖出手续费与仓位超额保护。

**重要限制：** 这是本地已确认成交台账的计算结果，不是 Binance 当前真实持仓快照；外部转入/转出、手动交易、其他设备交易、未同步成交和旧历史记录都会造成差异。不能单独用该结果发单。调用卖出预检前仍必须与 Binance 现货 free/locked 数量核对。当前底仓比例从 V3.3 配置读取；如未来调整历史资产的 baseRatio，需要迁移/快照策略参数，否则历史仓位拆分可能变化。

## 第十二阶段：买入历史参数固化
- 修正基础币手续费重复计入 USDT 支出的口径：基础币手续费只影响净持仓数量，不再计入 USDT 订单支出/手续费汇总；USDT 手续费仍计入成本，第三资产手续费仍 fail-closed。


- `BuyOrderIntent` / `QueuedBuyOrder` 新增 `baseRatioAtSignal`，新信号入队时按当时 V3.3 核心/保守配置写入 0.4 或 0.2。
- `createQueuedBuy` 在运行时校验比例必须是 0 到 1 之间的有限数值。
- `recordConfirmedBuyFill` 从原始待买订单读取冻结比例，并将 `baseRatioAtBuy` 写入每一笔已确认 BUY 成交台账；同一订单的部分成交始终使用相同参数。
- 持仓回放不再读取当前 `strategy.config` 的比例，而是逐笔读取每个 BUY fill 的历史比例，因此后续调整策略不会重算旧持仓的底仓/周期仓拆分。
- 旧 IndexedDB 待买订单若缺少比例，拒绝新成交入账；旧成交台账若缺少比例，持仓回放停止并提示人工核对，不自动用当前比例补齐。
- 新增测试覆盖核心/保守比例固化、无效比例拒绝、不同历史比例混合回放，以及旧记录缺参阻断。

**迁移提示：** 此阶段只新增记录字段，不升级 IndexedDB schema。旧数据保留原样；在确认每笔旧买入所属策略参数前，不会自动修改旧记录或假定历史比例。若本地已有旧成交记录，卖出预检会因缺少历史比例 fail-closed，需要先人工核对/迁移。


## 第十三阶段：持仓差异诊断报告（只读）

- 新增 `buildPositionReconciliationReport`：分类本地成交台账与 Binance 余额差异，状态包括数量一致、交易所余额较高、本地台账较高、Binance free/locked/total 内部不一致。
- 报告包含本地账本数量、Binance free、locked、total、差额、容差、是否允许继续进入独立卖出预检，以及可供人工排查的原因提示。
- 新增 `getPositionReconciliationReportFromBinance`：从本地成交台账重建持仓并读取 Binance 资产余额，输出只读诊断结果。
- 新增测试覆盖交易所余额多出、本地账本数量多出、交易所余额字段内部不一致和数量匹配。

**安全边界：** 报告不会把余额差额自动记成买入、卖出或转账，不会改变成本、底仓或周期仓，也不会自动修复任何记录。只有 `status=matched` 才表示数量层面一致；真正的卖出预检仍走原有严格核对函数，报告本身不授权下单。


## 第十四阶段：Spot 优先、Simple Earn 活期补足（资金调度规划）

- 用户确认的资金策略：闲置 USDT 留在 Simple Earn Flexible 赚取利息；买入时优先使用 Spot USDT；Spot 不足时只赎回 Flexible Earn 差额。
- `wallet-funds.ts` 提供 Spot 优先资金计划；`earn-redemption.ts` 按 Flexible productId 分配差额、生成稳定赎回意图 ID，并校验状态迁移。
- IndexedDB 升级到 v4，新增 `earn-redemption-intents`，赎回意图 add-if-absent，重复刷新复用已有意图，不重置状态、不擅自改变金额。
- `earn-redemption.browser.ts` 读取现货余额、Flexible 持仓和其他赎回意图；先原子预留本订单 Spot 份额，再计算活期理财缺口。赎回到账核验成功后扩展本订单 Spot 预留。
- `binance.browser.ts` 按 Binance 实际 Flexible position 字段 `totalAmount` / `productId` / `canRedeem` / `collateralAmount` 读取并归一化；Locked position 使用 `amount` / `redeemingAmt`；另有赎回历史只读查询。
- Spot 账户中的 `LD...` 资产代码不再猜测映射成基础币；Simple Earn 持仓以专用 position API 为准。
- `BuyQueue.tsx` 新增“资金来源规划”，展示 Spot 使用金额、Flexible 计划赎回金额和未满足金额。
- 赎回只有在精确匹配 Binance redemptionId、USDT、金额、SPOT 目的账户，并且 Spot free 相对赎回前基线增加足额后，才标记到账。
- 请求超时进入 `reconcile_required`；没有 redemptionId 时不允许盲目重发。Locked Earn 永远不进入自动赎回计划。
- 新增测试覆盖多产品分配、重复意图、跨订单预留、超时复核、历史记录匹配和到账确认。

**当前边界：** 资金来源规划按钮只调用 GET USER_DATA 和本地 IndexedDB，不会赎回或下单。Binance 官方把 `POST /sapi/v1/simple-earn/flexible/redeem` 标为 `TRADE` 权限；用户当前只读 Key 无法执行。尚未实现真实赎回提交器，也没有 Spot order POST。真正启用前必须先解决浏览器端 Secret 暴露问题，并经用户确认开启所需权限。参考：[Binance Simple Earn API](https://developers.binance.com/en/docs/catalog/investment-and-services-simple-earn/api/rest-api/flexible-locked)。

## 第十五阶段：Spot 市价买单提交适配器

详细实现和安全边界见 [PHASE_15.md](./PHASE_15.md)。当前实盘开关保持关闭，不会提交任何买单。

## 第十六阶段：卖出订单标识恢复与人工对账

- 卖出事件在未来提交前可持久化 clientOrderId；对账时优先使用 exchangeOrderId，否则按 clientOrderId 只读查询并恢复订单 ID。
- `SellQueue` 提供手动“核对 Binance 卖单”入口。
- 当前没有完整卖单提交编排；SELL POST 适配器默认关闭，不会发送请求。

## 第十六阶段：卖出提交编排与自动只读对账

见 [PHASE_16.md](./PHASE_16.md)。买卖队列在看板打开时每 30 秒自动核对已提交订单；此过程只读，不会重发订单。买卖实盘开关仍关闭。

## 第十七阶段：成交邮件 Outbox 安全投递

- 成交 Outbox 在 IndexedDB 中原子领取租约，过期租约可恢复，失败重试使用指数退避。
- `/api/trade-fill-notifications` 仅接受精确 Origin 和有效 Cloudflare Access JWT，并由服务端 HMAC 签名转发 Worker。
- `ExecutionBackground` 在看板打开且标签页可见时每 30 秒尝试投递。
- 需要配置 Cloudflare Access、应用服务端环境变量并部署 Worker；未配置时接口 fail-closed，不会把 HMAC Secret 暴露给浏览器。
- 详细部署要求见 `workers/TRADE_FILL_EMAIL_SETUP.md`。

## 第十八阶段：自动执行周期

`ExecutionBackground` 已提升到 Dashboard 根级，并包含受开关控制的 BUY / SELL / Flexible Earn 资金调度周期。三个实盘开关均为 `false`，当前只会自动对账和投递邮件，不会发出交易/赎回 POST。详细规则见 [PHASE_18.md](./PHASE_18.md)。
