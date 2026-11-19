# GPT 工作记录

> 维护者：GPT
> 主开发分支：gpt
> 最后更新：2026-11-19
>
> **协作约定**：每次开始开发前，必须先读取本文件和 grok工作记录.md，核对已实现/未实现事项、分支及同一文件/策略语义的修改。若本文件不存在则创建；若发现冲突，先写明冲突与合并决策，再修改代码。

## 一、当前开发边界与安全规则
- 当前阶段以模拟测试、只读核验和代码安全加固为主。
- 生产现货 BUY/SELL 开关保持关闭；Simple Earn 自动赎回保持关闭。
- 不使用用户真实余额做开发测试，不发送真实订单，不申购/赎回/划转。
- API 密钥仅由用户在本地环境文件配置；仓库只保留示例变量，不写入真实 Key/Secret。
- 订单提交结果不明确时必须进入对账/人工复核，不得盲目重试以避免重复下单。
- 浏览器 IndexedDB/localStorage 是本地浏览器配置级数据，不等于交易所级资金锁，也不保证跨设备同步。

## 二、已实现（GPT 侧）

### A. 策略与止盈后回补
| 项目 | 位置 | 当前实现 |
|---|---|---|
| 2x / 3x / 5x 止盈档 | strategy.config.ts、strategy/engine.ts | 按当前周期仓比例 50% / 30% / 80%；严格按档位顺序，前档确认后才执行后档 |
| 止盈成交重放 | strategy/post-take-profit-rebuy.ts | 使用本地已确认卖出事件与成交台账重放持仓、成本和均价 |
| 止盈后均价回补 | 同上 | 任意止盈档有确认成交后，关闭旧头仓锚定补仓及备用金，只按当前均价的四档跌幅回补 |
| 新持仓周期重置 | 同上 | 持仓归零后退出本轮止盈/回补状态，新一轮重新按开仓规则 |
| 历史完整性保护 | 同上 | 台账缺失、成交不完整或重放持仓不匹配时 fail-closed，暂停该币策略操作 |
| 成本与净数量 | lib/binance.ts、lib/dashboard.ts | 处理基础币手续费净数量及买入成本，透传成交订单 ID |
| 说明文档 | STRATEGY.md、components/StrategyInfo.tsx、lib/execution/PHASE_28.md | 记录规则及本地历史存储边界 |

**重要限制**：本地卖出事件/成交台账存于当前浏览器 IndexedDB，清理站点数据或更换浏览器设备可能丢失；存在手动交易或外部成交而本地台账未记录时，系统会暂停策略而非猜测。

### B. 自动买入与执行可靠性
| 项目 | 位置 | 当前实现 |
|---|---|---|
| 待买订单和资金预留 | lib/execution/store.browser.ts 等 | IndexedDB 事务管理队列及资金预留 |
| 原子认领/幂等提交 | lib/execution/buy-order-submit.browser.ts、client-order-id.ts | 以 event/attempt 生成确定性 clientOrderId，避免同一任务重复提交 |
| 买入订单对账 | lib/execution/sync-buy-order.browser.ts | 按 clientOrderId 查询订单并核对逐笔成交 |
| 部分成交预留 | store.browser.ts | 已确认支出递减可用预留；未终态订单继续保持锁定 |
| 终态释放 | 同上 | 仅在交易所订单终态后释放未使用部分 |
| 成交唯一性 | fill-reconcile.ts、store.browser.ts | 按成交 ID 去重；重复成交数据冲突时拒绝记账 |
| 通知 Outbox | store.browser.ts、workers | 成交记录与通知事件原子写入，异步发送可重试 |
| 多标签页旧 attempt 防护 | buy-order-submit.browser.ts、sync-buy-order.browser.ts | 所有异步状态回写携带原 attempt；过期任务不能覆盖新 attempt |
| 买入成交台账一致性 | store.browser.ts | 重复 BUY fill 同时核验 fill 索引和 ledger 记录，缺一或内容冲突则 fail-closed |

### C. 验证记录
- Phase 28 代码提交曾通过 37 个测试文件、280 个测试。
- Phase 29（2026-11-19）新增买入对账 attempt 防护测试，并加强重复 BUY fill 台账核验。
- Phase 29 验证：38 个测试文件通过、284 个测试通过、tsc --noEmit 通过。
- CI：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44475066618
- Phase 29 代码提交：af98fce8ec985dc63b57f845da85ae2542d18f40
- Phase 29 文档提交：ee0b7aef1e6618c2eb564c211d2c1aebfc150f6f

## 三、未实现 / 仍需验证
| 优先级 | 项目 | 当前状态 / 风险 |
|---|---|---|
| P0 | 资金预留全链路压力测试 | 仍需覆盖两个标签页同时认领、并发预留、部分成交/终态交错、浏览器崩溃恢复等竞争场景 |
| P0 | 买入订单状态管理中心 | 已新增只读总览 ExecutionStatusPanel：汇总买卖待处理数、需对账数、活动资金预留、通知待处理；更细的逐笔恢复/人工处理工作流仍未完成 |
| P0 | IndexedDB 恢复与损坏处理 | 需进一步验证升级、事务中断、站点数据清理、重复初始化等情形 |
| P1 | 自动卖出完整闭环 | 有 SELL 提交/核验基础，但未完成全链路模拟验收；实盘开关仍关闭 |
| P1 | 止盈后回补与预备订单计划统一 | 主策略已接入 post-take-profit-rebuy；Grok 侧另有 prep-order 计划层，存在双轨语义，需要先对齐 |
| P1 | 历史底仓比例 | 当前回放保护底仓仍需检查是否应严格按每笔买入历史 baseRatioAtBuy 计算，而非当前 profile |
| P1 | 外部/手动交易同步 | 未建立可靠的交易所全量成交导入和跨设备同步；本地台账不完整时应继续暂停 |
| P2 | 行情实时性 | 尚未实现 WebSocket 实时触价；当前以定时刷新/缓存为主 |
| P2 | 交易执行服务端化 | 浏览器本地执行队列不具备跨设备单实例调度和交易所级互斥能力，尚未迁移为可靠服务端调度器 |
| P2 | 生产联调与风险演练 | 尚未完成；不得把 mock/CI 通过描述为真实交易测试 |

## 四、与 Grok 工作记录的冲突检查（2026-11-19）
已读取 grok工作记录.md，并检查其所述预备订单文件与当前 GPT 主策略的关系。

### 发现的差异
1. Grok 记录的 lib/execution/prep-orders.ts、prep-orders-csv.ts、prep-store.browser.ts、components/PrepOrdersPanel.tsx 是计划/CSV/UI 层。
2. GPT 主策略的止盈后均价回补位于 strategy/post-take-profit-rebuy.ts，基于确认的交易成交台账驱动实际策略信号。
3. Grok 记录明确说明预备订单目前不会自动下单，且不会自动侦测交易所止盈；需要手动点「记止盈」。
4. 因此两者目前不是同一执行真源：一个是用户维护的计划状态，一个是成交台账驱动的策略状态。若不明确边界，UI 可能显示的预备订单与自动策略队列不同步。

### 当前处理决定
- 暂不删除或覆盖 Grok 的预备订单模块。
- 暂不把 CSV/localStorage 计划状态接入自动下单。
- 自动策略的止盈/回补判断继续以已确认成交事件和执行台账为准。
- 下一次改动预备订单前，先逐文件对照其数据模型、状态转换和 Dashboard 挂载点，再决定将其明确标为「人工计划/导出工具」，或设计只读投影映射到主策略；禁止形成第二个可独立下单的信号源。
- 已按 Grok 记录确认：唯一开发分支为 gpt；grok 分支废弃，不再作为开发线。所有协作提交均落在 gpt。

## 五、每次开工前检查清单
- [ ] 读取 gpt工作记录.md 最新版本。
- [ ] 读取 grok工作记录.md 最新版本。
- [ ] 获取 gpt 分支 HEAD，检查两份记录对应的代码是否已变化。
- [ ] 确认本次改动文件是否与另一方工作重叠。
- [ ] 若策略语义/数据真源冲突，先记录决策再改代码。
- [ ] 修改后更新本文件：已实现、未实现、测试结果、commit SHA、CI URL。
- [ ] 不启用真实交易，不使用真实资金做测试。

## 六、变更日志
| 日期 | 摘要 |
|---|---|
| 2026-11-19 | 创建 GPT 工作记录；读取并核对 grok工作记录.md；确认预备订单计划层与成交台账驱动主策略存在双轨状态风险；记录 Phase 29 买入 attempt fencing 与重复成交台账核验；新增只读执行状态总览面板。 |


## 七、Phase 30 — 执行状态总览（已完成）

- 新增 `components/ExecutionStatusPanel.tsx`，只读汇总买入/卖出待处理订单、需对账数量、活动资金预留金额和通知待处理数。
- 在 Dashboard 的队列 Tab 和主页面挂载总览。
- 该面板只读取现有 IndexedDB stores，不创建订单、不释放资金、不触发对账、不发送交易。
- 验证通过：38 个测试文件、284 个测试通过，`tsc --noEmit` 通过。
- CI：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44477012135
- 面板代码提交：`7df38d462b00efdd46f69351eb972298806d1564`；Dashboard 挂载提交：`3bc72689986c91205ec8f142c3e1e48391d5ccd5`。
- 与 Grok 预备订单模块无文件重叠，本阶段不修改 prep-orders / PrepOrdersPanel，也不将 CSV 计划作为自动执行真源。


## 八、Phase 31 — GPT / Grok 并行分工（2026-11-19）

### 分工原则
- 两条任务线在文件层隔离，统一提交到 `gpt` 分支。
- Grok 负责预备订单人工计划及 CSV 工具；GPT 负责资金预留、买入订单状态恢复和 IndexedDB 安全。
- 两边不得擅自修改对方负责的核心文件；若发现必须跨边界修改，先在两份记录中提出并等待用户确认/协商。
- 双方均不修改 `components/Dashboard.tsx`，避免 UI 集成冲突。
- 不将 Grok 的 localStorage/CSV 计划状态接入自动下单；自动执行真源仍是已确认交易所订单与成交台账。
- LIVE BUY/SELL 与 Simple Earn 自动赎回继续关闭，不使用真实余额或发送真实订单测试。

### Grok 负责（不与 GPT 本阶段冲突）
**允许修改：**
- `lib/execution/prep-orders.ts`
- `lib/execution/prep-orders-csv.ts`
- `lib/execution/prep-store.browser.ts`
- `components/PrepOrdersPanel.tsx`
- 与上述文件直接对应的独立测试、预备订单说明文档。

**任务目标：**
1. 完善人工计划生成、止盈后重建、回补后触发价刷新规则。
2. 加强计划状态和 CSV 导出的一致性、输入校验及异常处理。
3. 为预备订单核心逻辑补充单元测试；明确 CSV 是导出快照，不是执行真源。
4. UI 继续明确标注人工计划，不展示为交易所已挂单或自动执行状态。
5. 不修改 `Dashboard.tsx`、资金预留、买入提交/对账、成交台账和自动执行开关。
6. 更新本文件 `grok工作记录.md`，记录文件、测试、commit SHA 和 CI。

### GPT 负责（当前继续执行）
**允许修改：**
- `lib/execution/fund-reservation.ts`
- `lib/execution/store.browser.ts`
- `lib/execution/buy-order-submit.browser.ts`
- `lib/execution/sync-buy-order.browser.ts`
- 上述资金预留/恢复逻辑的独立测试文件，以及必要的执行层技术文档。

**任务目标：**
1. 审查并发资金预留是否在同一 IndexedDB 事务内完成预算核算与写入，避免多标签页超额预留。
2. 验证同一订单重复 reserve、两个不同订单并发 reserve、并发 claim 的幂等与互斥行为。
3. 验证部分成交后累计已确认支出单调增加，预留不会被错误恢复或重复扣减。
4. 验证非终态、POST 结果不明确、交易所查询失败时资金预留持续锁定。
5. 验证交易所明确终态后只释放未使用金额，且旧 attempt 的迟到结果不能修改新状态。
6. 验证浏览器重启/重新打开页面后可恢复 pending / reconcile_required 状态；IndexedDB 打开、读写、事务失败时 fail-closed。
7. 先盘点现有测试再补充缺口，不重复造已有测试；不得把 mock/CI 结果说成真实交易验证。
8. 更新本文件，记录测试结果、commit SHA 和 CI。

### 本阶段验收边界
- Grok 的预备订单计划状态与 GPT 的执行台账状态仍是两个不同层级，不做隐式自动同步。
- 本阶段只做代码和模拟测试；不打开实盘开关、不提交 Binance 订单、不操作资金。
- 若发现同一文件或策略语义冲突，先暂停冲突部分并记录，不以覆盖对方代码的方式解决。

### 分工日志
- 2026-11-19：完成 Grok / GPT 任务拆分；Grok 负责预备订单计划层，GPT 负责资金预留与订单恢复安全；明确文件白名单及禁止修改的共享 Dashboard 文件。


## 九、Phase 31 — 资金预留与买入 attempt 安全加固（进行中）

### 已完成的代码修复
1. **资金预留写入增加 attempt fencing**
   - `applyConfirmedBuyReservationSpend` 与 `releaseBuyFundsReservation` 现在在同一 IndexedDB readwrite transaction 中同时读取 `buy-orders` 和 `buy-funds-reservations`。
   - 两个写入口都必须传入发起对账的 `expectedAttempt`；若订单 attempt 已变化或不再处于当前对账锁定状态，事务中止，不修改资金预留。
   - `sync-buy-order.browser.ts` 将原始 attempt 传入资金预留更新和零成交终态释放。

2. **成交后继续保持订单锁定**
   - 发现 `recordConfirmedBuyFill` 原本调用 `applyConfirmedBuyFill` 后会立即把订单状态改成 `partially_filled/filled`，但交易所订单可能仍未终态；这会导致后续 attempt guard 拒绝同一次对账的资金更新/终态收敛。
   - `queue.ts` 现对 `reconcile_required` 状态的订单保留该锁，直到交易所终态快照被确认后才由 `markBuyOrderReconciled` 转为 `pending/partially_filled/filled`。
   - 新增部分成交和全量成交但交易所订单仍未终态时保持锁定的测试。

3. **资金预留数据损坏时 fail-closed**
   - `planBuyFundsReservation` 检查所有活动预留的金额有限性、原始预留/已消耗/剩余金额关系，以及活动订单 ID 重复。
   - 发现损坏或重复的活动预留时，拒绝继续分配共享 USDT 余额。
   - 已释放预留的最终成交累计值必须保持不变；后续快照出现变化时要求人工复核。
   - `reserveBuyFunds` 在复用活动预留前先完整校验，并检查同一订单 ID 的交易对一致性。
   - Earn 到账后扩展预留也先校验其他活动预留，再计算可用金额。
   - 预留与扩展入口校验时间戳及输入参数。

4. **IndexedDB 连接升级保护**
   - 打开执行数据库时处理 `onblocked`，提示关闭旧标签页后重试。
   - 数据库连接监听 `onversionchange` 并主动关闭旧连接，避免旧 Dashboard 标签页长期阻塞后续 schema 升级。

### 本阶段修改文件
- `lib/execution/store.browser.ts`
- `lib/execution/fund-reservation.ts`
- `lib/execution/queue.ts`
- `lib/execution/sync-buy-order.browser.ts`
- `lib/execution/sync-buy-order.browser.test.ts`
- `lib/execution/fund-reservation.test.ts`
- `lib/execution/queue.test.ts`

### 验证
- GitHub Actions：39 个测试文件通过、297 个测试通过、TypeScript typecheck 通过。
- CI：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44478570533
- 当前 GPT 代码最新提交：`4dea257e8756f2c6d96ca4a112123fc3dc104638`。
- 之前一次 CI 因新增的 safe-to-retry 测试 mock 未返回订单对象而失败；已修正测试 fixture，后续 CI 通过。该失败不是生产代码测试失败。

### 尚未完成（不得标记为 P0 全部完成）
- 尚无真实 IndexedDB 多标签页并发集成测试：需验证两个不同订单并发预留不会超额、同一订单并发 claim 只有一个成功、并发 reserve/claim 交错时不会双提交。
- 尚无浏览器重启后从 IndexedDB 恢复状态的端到端测试。
- 尚无 IndexedDB quota / blocked / transaction abort / schema upgrade 的完整自动化故障注入测试。
- 资金预留仍是浏览器本地协调机制，不是 Binance 交易所资金锁；没有跨设备互斥。
- 本阶段全部为代码与 CI 模拟测试，未发送 Binance 订单，未操作真实余额；实盘开关保持关闭。

### 与 Grok 本轮协作核对
- Grok 已完成预备订单 `planKind: manual_prep`、校验、CSV/store 归一化和 UI「人工计划 / 非挂单」标记。
- Grok 修改文件均在其白名单内，没有与本阶段 GPT 文件冲突。
- Grok 记录已补充分工边界；预备订单仍不接入自动下单。


## 十、Phase 32 — 扩大 Grok 并行任务范围（2026-11-19）

### 本轮新分工
- **Grok 主责成交通知可靠性**：`notification-outbox.ts`、`notification-dispatch.browser.ts`、对应测试、`notification-signature.server.ts`、签名测试、`app/api/trade-fill-notifications/route.ts`。
- **Grok 主责 SELL 卖出链路审查与模拟测试**：sell-guard、sell-signal-queue、sell-store、sell-order dry-run/submit guard、sync-sell-order 及其 SELL 专属测试。
- Grok 不得修改共享 BUY store、BUY 队列、成交台账、position-accounting、Dashboard、策略配置及 BUY 资金预留。
- GPT 继续负责 BUY 资金预留并发/IndexedDB 恢复及故障注入测试。
- 通知模块只能消费已确认成交事件；不得改变成交台账真源或原子写入边界。
- SELL 只做 mock/dry-run/模拟测试；实盘卖出开关保持关闭，不发真实订单。
- 若 SELL 发现需要跨入共享文件的缺陷，先在 Grok 工作记录提出，不直接改共享文件。

### GPT 本轮继续任务
1. 核验 IndexedDB 资金预留预算核算和写入是否在同一 readwrite transaction 中，重点检查两个订单并发预留是否真正串行化。
2. 设计并实现浏览器 IndexedDB 并发测试：两个不同订单并发预留不得超额、同一订单重复预留保持幂等、并发 claim 只有一个赢家。
3. 补充订单浏览器重启/重新加载后的恢复测试，以及 transaction abort / blocked / unavailable 场景的 fail-closed 测试。
4. 不引入未审查的新依赖；若测试环境缺少真实 IndexedDB 实现，先评估项目现有浏览器测试设施，不以纯 mock 假冒跨标签页原子性。

### 当前验证基线
- GPT 最新 HEAD（分工开始前）：`f1b6025e9b8f9f2874b01106ca1b73d472ee61b6`。
- 最近 CI：39 个测试文件、297 个测试通过；TypeScript typecheck 通过。
- CI：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44478709778


### Grok SELL 范围补充
另包含 `lib/execution/sell-preflight.browser.ts` 与其专属测试；只审查 SELL 专属预检，不修改共享 `binance-preflight.ts`、BUY 预检或资金预留。


## 十一、Phase 32 — BUY 资金预留事务与 Earn top-up 修复（进行中）

### 本轮发现并修复的问题
1. **预留前未在同一事务确认订单仍可执行**
   - 原 `reserveBuyFunds` 只对资金预留 store 开 readwrite transaction；它没有在同一事务中读取当前待买订单。
   - 预检后如果另一标签页已将订单推进到 `reconcile_required`，旧标签页仍可能先写入资金预留。
   - 现改为同一事务同时读 `buy-orders` 与 `buy-funds-reservations`，仅允许当前订单状态为 `pending/partially_filled` 且交易对匹配时建立预留。

2. **Earn 到账 top-up 旧快照竞态**
   - 原 `topUpBuyFundsReservationAfterEarnCredit` 未读取当前订单状态/版本，可能在订单已变化后仍扩展预留。
   - 现要求调用方传入 `expectedAttemptCount`、`expectedOrderUpdatedAt`；store 在同一 readwrite transaction 中核对订单状态、attempt、更新时间和剩余金额，任何不匹配均 abort。
   - 预留扩展改为只增加可用余额允许的差额，不会缩小已有预留；若已有预留总额已超过当前观察到的可用余额，则 fail-closed。
   - 已终态释放的旧 attempt 若开始新 attempt，重置该 attempt 的累计支出基线为 0，避免新 attempt 的成交快照与旧 attempt 的累计值混用。

3. **提交 claim 参数校验**
   - `claimBuyOrderSubmission` 现在校验订单 ID 与时间戳参数。

### 新增测试基础设施和集成测试
- 新增开发依赖 `fake-indexeddb@6.2.7`（仅测试用，无运行时依赖）。
- 新增 `lib/execution/store.browser.test.ts`，通过多连接 IndexedDB API 测试：
  - 两个不同订单并发 reserve，总预留不超过共享 free snapshot。
  - 同一订单并发 reserve 幂等，只生成一条预留。
  - 同一订单并发 claim 只有一个成功。
  - 关闭连接后重新打开，队列状态仍可读取。
  - 订单状态变更后旧预检不能建立资金预留。
  - Earn top-up 仅在订单快照未变化时成功。
  - 新 attempt 的预留支出基线重置。
  - IndexedDB 不可用时 fail-closed。
- 扩展 `fund-reservation.test.ts`：覆盖 top-up 差额计算、保留已有预留、已有预留超过可用余额、released 记录损坏和订单状态/交易对校验。

### 修改文件
- `lib/execution/fund-reservation.ts`
- `lib/execution/fund-reservation.test.ts`
- `lib/execution/store.browser.ts`
- `lib/execution/store.browser.test.ts`（新增）
- `lib/execution/earn-redemption.browser.ts`
- `package.json`
- `package-lock.json`

### 验证状态
- 最新可读取的代码 CI（run 44480382213）：`store.browser.test.ts` 10 项通过；全套 40 个测试文件中 39 个通过、319 项测试通过，另有 1 个 Grok 负责的 SELL guard 用例失败。
- TypeScript typecheck 通过。
- 失败用例：`lib/execution/sell-guard.test.ts` 的「底仓减仓未显式允许时拒绝」。GPT 已在 `grok工作记录.md` 留下反馈，未修改 Grok 文件。
- CI：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44480382213
- 本轮 GPT 代码提交：
  - `996c2885c8879f7a542187b614a4265b485836fa`（top-up 纯逻辑）
  - `b6169ed8286a896a337d02c48288bc8777b32806`（订单/预留同事务校验）
  - `07fbe49fd72c3492afd6dfc42d03c7d30dba2bf6`（Earn 调用方快照）
  - `353828f2601c1f5ffb3cc698273b8b140402521c`（余额不足保护）
  - `4c4d3c3c0680220ea4bbb6b44e087039e8ee0b88`（top-up 纯逻辑测试）
  - `8af01ffa26045d83e02367fed665a9a5e7851054`、`69783892fc77f842ada31e48367955118044f779`、`6c0ada99d5ef0d17c9a181926da253348987fadb`（数据校验和 attempt 基线）
  - `f8b40221903a63c1484446cd16ae848685fc722e`、`ed4a3722082d05eccd1799f54b42b8448f0f3b64`（测试依赖）
  - `0ddaa859ff788aa79233a7e91d960388dd046d2f`、`0a8e5f7917dec20e2b6e1189557a449eb402d9d0`、`8851313d6897fece3158393b6f3ae2ebba91f797`、`f2f65d0b9d6c1b16b91e2522d3216be8f1c22306`（IndexedDB 测试）
- **测试边界**：fake-indexeddb 可验证 IndexedDB API/事务行为和同一运行时的多连接竞争，但不是 Chrome 多进程真实标签页测试，也不是浏览器进程重启测试；后两者仍待真实浏览器 E2E 验证。

### 尚未完成
- 真实浏览器多标签页/多进程并发测试。
- 浏览器进程重启后的持久化恢复 E2E。
- IndexedDB transaction abort、blocked schema upgrade、quota exceeded 的故障注入。
- Grok SELL guard CI 失败尚待 Grok 修复；GPT 不修改其白名单文件。
- 本轮所有测试均为模拟/测试数据库；未发送 Binance 订单、未操作真实资金，实盘开关保持关闭。
