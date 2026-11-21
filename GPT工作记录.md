# GPT工作记录

> 主开发分支：gpt。规则依据：`项目规则.md`、`策略3.3.xlsx`。总任务以 `自动交易系统总需求清单.md` 为准。
> 旧记录（至 2026-11-21）已由 Claude 归档到 `docs/归档/GPT工作记录_至2026-11-21.md`，需要查历史再读，不必每次通读。

## 任务分配（分配人：Claude，技术主管，2026-11-21）

Claude 判断：项目已转为本地优先，GPT 负责"本地常驻执行器"主干和 Testnet 验收。你之前写的 Cloudflare DO 状态机、对账、成交结算逻辑有价值，要迁移复用，不要整体丢弃。

### 你的任务（按顺序）

1. **M0-01 清点 Cloudflare 残留**。列出 `execution-account-do*`、`scheduler-task*`、`strategy-intent-cron.server*`、`cloudflare-access*`、`/api/execution/intents` 及相关测试，标注"可迁移逻辑/纯 DO 代码"。写进本记录，等 Claude 确认后再删，不要直接删。
2. **M1-01 本地持久化存储**。在 `lib/execution/server/` 新建存储层（首选 `node:sqlite`，数据文件在 `data/`）。**先把接口（TypeScript 类型 + 方法清单）写进本记录**，Grok 需要据此做 M1-04。事务语义对齐原 DO，特别是"fill+reservation+终态同事务"。
3. **M1-02 常驻进程 `npm run trader`**，单实例锁，不依赖浏览器。
4. **M1-03 unknown 订单恢复**，崩溃重启后按原 clientOrderId 查单。
5. **M0-03 规则矩阵逐项核验**，差异只记录，不改参数。
6. **M3-01 / M3-02 / M3-03** 统一模式开关、启动自检、故障保护（仅异常熔断与 `data/STOP`；用户已确认无单日/单笔上限，按策略交易；已确认不使用 Cloudflare）。
7. **M1-05** 看板改只读。
8. **M2-01 / M2-03 / M2-04** Testnet 实测与 72 小时报告。

### 文件白名单（GPT 主责）
`lib/execution/server/**`（新建）、`lib/execution/server-execution-core*`、`order-reconcile*`、`fill-reconcile*`、`fund-reservation*`、`buy-*`、`binance-*`、`strategy/**`、`strategy.config.ts`、`app/api/**`、`components/**`、`package.json`。

### 不要动
`sell-*`、`earn-redemption*`、`notification-*`、`mail-notify.ts`（Grok 主责）。需要改请先在本记录写明并等对方确认。

### 对你的要求
- 每完成一项，在下面"完成记录"追加：目标、修改文件、测试命令与结果、commit SHA。
- 复核 Grok 的 M0-02、M1-04、M2-02、M3-04、M3-05、M3-06，结论写在本记录。
- 不得使用真实 Key；不得开启生产开关。`AUTO_TRADE_MODE=production` 的自动化测试只允许用 mock。
- 不得让 Mock/Fake 测试冒充 Testnet 实测。
- 先做 M0-01 和 M1-01 接口，再写大量代码。接口不稳，Grok 无法并行。

## 安全约束（长期）
- 生产 BUY/SELL、Simple Earn 真实赎回默认关闭，只有用户明确授权才能开。
- 订单结果不明必须按 clientOrderId 对账，禁止盲目重发。
- 策略参数以 Excel 为准，用户 A2–G2 决策见 `docs/策略3.3/策略3.3用户确认决策.md`。

## 完成记录
（从这里往下追加。格式：日期、任务编号、修改文件、测试结果、SHA）


## 2026-11-21｜M0-01 Cloudflare残留清点与M1-01本地存储接口发布

### M0-01：残留清点（本轮不删除，等待Claude确认）
当前分支已没有根目录`wrangler.jsonc`、`wrangler.test.jsonc`、`worker.ts`或Cloudflare Worker构建入口；但仍残留以下代码和文档。按Claude要求，先提交清点，不擅自删除：

| 路径 | 分类 | 处理建议 |
|---|---|---|
| `lib/execution/execution-account-do.ts` | 纯Durable Object/SQLite绑定与HTTP内部路由 | **整体DO外壳不迁移**；迁移领域能力：intent幂等、attempt/clientOrderId、账户锁与reservation原子claim、lease fencing、unknown冻结、reconcile-only takeover、fill核对及fill+reservation+终态+锁释放单事务 |
| `lib/execution/execution-account-do.test.ts` | FakeSql模拟DO测试 | 不能作为本地SQLite验收；将行为用例迁移为`node:sqlite`真实文件数据库集成测试后再删除 |
| `lib/execution/scheduler-task-core.ts` | 纯函数调度领域逻辑 | 可复用稳定taskId校验、白名单、lease fencing、退避与最大重试转人工复核；本地实现不依赖DO Alarm |
| `lib/execution/scheduler-task-core.test.ts` | 纯函数测试 | 可保留并复用；按本地调度器接口补测 |
| `lib/execution/scheduler-task-do.test.ts` | FakeSql + DO HTTP接口测试 | 用本地SQLite调度任务测试替代后删除 |
| `lib/execution/reconcile-intent-dispatcher.server.ts` | 通过HTTP stub调用DO的对账编排 | 保留只读Binance查单/成交核验流程；改为直接依赖`LocalExecutionStore`，移除内部HTTP、DO租约/任务stub |
| `lib/execution/strategy-intent-cron.server.ts` | Worker Self Reference / Cron调用器 | Worker专属部分删除；将策略信号重算和intent生成迁入本地常驻Trader循环 |
| `lib/execution/strategy-intent-cron.server.test.ts` | Worker Service Binding测试 | 迁移为本地Trader扫描/禁用开关测试后删除 |
| `lib/execution/cloudflare-access.server.ts` | Cloudflare Access JWT验证 | 仅用于成交通知API的可选CF Access分支；需等Grok完成M3-05本地认证/邮件直发改造并移除引用后再删除 |
| `lib/execution/cloudflare-access.server.test.ts` | 上述JWT验证测试 | 与模块一并移除；不能先删测试导致Grok通知路由编译失败 |
| `app/api/execution/intents/route.ts`及测试 | 通过`globalThis.EXECUTION_ACCOUNT`查找DO的旧HTTP入口；本地未绑定时返回503 | 本地Trader应直接调用服务端策略计算和Store，不应通过本API自调用；评估删除或改为只读状态/手动dry-run入口，待本地Trader接通后再处理 |
| `lib/execution/binance-reconcile.server.ts`、`binance-reconcile-plan.server.ts`及测试 | Binance服务端只读适配器与纯对账计划 | **可迁移复用，暂不删除**；它们不是Cloudflare专属，继续负责固定官方host、只读查单/myTrades/余额/规则和成交一致性核验 |
| `lib/execution/server-execution-core.ts`及测试 | 纯领域状态机、intent验证、lease fencing | **迁移复用，暂不删除**；剥离DO后由本地Store调用 |
| `lib/execution/order-reconcile.ts`、`fill-reconcile.ts`、`fund-reservation.ts`及测试 | 纯订单状态/成交/资金预留逻辑 | **迁移复用，暂不删除**；按本地持久化语义补集成测试 |
| `docs/策略3.3/服务端自动执行架构设计.md` | Durable Object/Alarm/Cron架构设计 | 本地Trader设计和验收文档完成后归档或改写，避免误导 |
| `lib/execution/README.md`、`README.md`、`docs/策略3.3/自动化交易落地路径.md` | 仍含DO/Cron/Worker说明 | M0-04由Grok主责同步；GPT只复核，不越界覆盖 |
| `app/api/trade-fill-notifications/route.ts` | 当前仍含可选CF Access + Worker HMAC转发 | 属Grok通知改造范围；M3-05完成本地邮件直发后移除Worker分支，再清理CF Access依赖 |

**M0-01结论：** 清点已完成，删除尚未执行。需Claude确认上表迁移/删除范围后，再分批移除纯DO/Worker代码；不得删除可复用的领域状态机、Binance只读对账、成交核验和资金预留逻辑。

### M1-01：本地存储接口（已发布，存储实现待做）

- 新增`lib/execution/server/store.ts`，提交`a9d53c393869966ad2260c321b0e9a08d12f7c2d`。
- 该文件只定义服务端领域接口，采用type-only导入，不在浏览器执行；底层目标为Node.js `node:sqlite`，数据库文件置于Git忽略的`data/`目录。
- 已公布给Grok的SELL适配接口：
  - `store.sellEvents.reserveSellEvent(record)`
  - `store.sellEvents.updateSellEvent(record)`
  - `store.sellEvents.listSellEvents()`
  - `store.sellEvents.claimSellEventForSubmission(eventKey, clientOrderId, now?)`
  - `store.sellEvents.bindSellEventToExchangeOrder(eventKey, exchangeOrderId, now?)`
  - `store.tradeLedger.listTradeLedger()`
  - `store.tradeLedger.recordConfirmedSellFill(fill, sellKind)`
- BUY/本地Trader核心接口：
  - `createIntent/getIntent/listRunnableIntents`
  - `claimIntent/renewExecutionLease/markSubmitting/markUnknown/takeoverForReconciliation`
  - `getReconcileContext/finalizeReconciledOrder/markManualReview`
  - `store.scheduler.enqueue/claimDue/renew/ack/retry/recoverExpired`
- 原子性硬约束：intent+账户锁+reservation+attempt原子领取；POST前先落盘clientOrderId/submitting；unknown只读恢复；fill唯一性、成交台账、reservation结算、订单终态、账户锁释放同一事务；SELL fill、台账和通知Outbox同一事务。SQLite事务内禁止网络IO/await。
- Grok可依据该接口开始M1-04适配，但不得改`lib/execution/server/**`；接口若需扩展，先在双方工作记录提出并协商。
- 当前状态：接口契约已提交；`node:sqlite`数据库schema/迁移、仓储实现、真实文件数据库事务/重启/并发测试尚未完成。不得把接口文件标记为M1-01整体完成。

### 当前分支基线
- 本轮读取的gpt分支基线：`50b600cf846b332ba339d7950d4f8ea00007f80b`；随后本次接口提交为`a9d53c393869966ad2260c321b0e9a08d12f7c2d`。
- 当前仓库以Claude 2026-11-21最新《自动交易系统总需求清单.md》为准：本地优先、不使用Cloudflare；此前DO SQLite/Cloudflare测试结果仅为历史实现证据，不代表当前目标架构验收。


### M1-01补充：本地SQLite基础层（阶段性）
- 新增`lib/execution/server/sqlite-database.ts`，提交`20f3d585c0da46682008f37ff820702eddf7113c`。
- 采用Node内置`node:sqlite`的同步`DatabaseSync`；默认数据库路径`data/trader.db`，创建目录权限0700、数据库文件权限0600；已配置WAL、foreign_keys、FULL synchronous和busy_timeout。
- 新增版本迁移表与首版schema，覆盖：`order_intents`、`order_attempts`、`exchange_orders`、`reservations`、`account_lock`、`fills`、`trade_ledger`、`buy_orders`、`sell_events`、`scheduler_tasks`、`notification_outbox`、`audit_events`。
- `LocalExecutionDatabase.transaction()` 使用`BEGIN IMMEDIATE/COMMIT/ROLLBACK`；拒绝返回Promise的异步事务回调，避免await期间持有事务锁或误把网络IO放入事务。
- 新增`lib/execution/server/sqlite-database.test.ts`，提交`8ab178ed40233fbcf2fd246720dc28b1693567d5`，覆盖首次schema、重复打开/数据持久化、异常回滚、拒绝async事务、关闭后拒绝访问。
- GitHub Actions Run `44870478846`通过：64个测试文件、504项测试通过；TypeScript typecheck、Next.js production build通过。链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44870478846
- 当前仍只是SQLite连接/迁移/事务基础设施，不是完整`LocalExecutionStore`；intent/attempt/reservation/账户锁/调度任务各方法实现、SELL/BUY原子成交落账、进程重启恢复/并发集成测试仍待完成。M1-01保持[~]。


### M1-01补充：SQLite仓储方法与订单恢复测试（阶段性）
- 新增`lib/execution/server/sqlite-store.ts`，提交`8d1ae26ae0f97dc4813ff96dbe65cd0705605b84`，导出`openLocalExecutionStore()`，实现`LocalExecutionStore`接口：intent幂等创建、待执行查询、基于新鲜余额快照的账户锁/reservation/attempt/clientOrderId原子claim、lease续期、POST前submitting、unknown冻结、过期lease的reconcile-only takeover、成交逐笔核对/订单终态/reservation消费/账户锁释放单事务、scheduler enqueue/claim/renew/ack/retry/过期租约恢复、SELL event持久化及SELL fill+台账+Outbox原子写入。
- 增加`baseRatioAtSignal`历史字段，避免BUY成交入账时用当前策略参数回填历史底仓比例；schema v2迁移`0b8390001436b440a68284b65fb561f8e774f59f`，BUY claim缺少有效历史比例时fail-closed。
- schema v3将交易所订单表`orig_qty`更名为`requested_amount`，避免把策略USDT预算误写成Binance原始base数量；迁移提交`967805194174e3f60e64db9e3a21dcaf6ab831b0`。
- 关键测试：进程关闭/重开恢复unknown订单原clientOrderId、账户lease和reconcile任务；并发scheduler claim只成功一次；过期账户租约只能reconcile-only接管；终态结算成功写fill/ledger/Outbox并释放锁；超出reservation时fill/ledger/Outbox及释放操作整体回滚；BUY台账保留历史baseRatio；SELL事件幂等和成交去重。
- 测试文件：`lib/execution/server/sqlite-store.test.ts`、`lib/execution/server/sqlite-database.test.ts`。
- GitHub Actions Run `44871362483`通过：65个测试文件、514项测试；typecheck和Next.js production build通过。链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44871362483
- 本轮曾出现schema版本断言和v1迁移样本不完整，已在最终通过的Run前修正。
- **仍未标记M1-01完成**：需要补充双独立SQLite连接竞争claim/账户锁、scheduler lease fencing失败路径、终态重复fill/Outbox冲突等边界测试，并由M1-02实际常驻进程接入验收。

### M0-02独立复核（2026-11-21）
- Issue #2 新增GPT复核评论`7057996567`。
- 当前`indexLedgerFillsForSellKind`仍先过滤非有限/非正qty再按symbol+fillId分组；因此同键有效SELL与qty=0/NaN/负数的冲突行并存时，冲突行可能被丢弃，无法确保fail-closed。
- `sell-enqueue-ledger.integration.test.ts`有混合BUY+SELL阻断，但`sell-automation-tick.integration.test.ts`仍缺少混合冲突tick集成用例；必须证明BTC阻断时同轮ETH可正常enqueue。
- M0-02仍未通过GPT复核；Grok不得启动M1-04，Outbox保持默认关闭。


## 交接说明（Claude，2026-11-21）
GPT 无法继续工作，未完成任务（M0-01 删除批准后的执行、M0-03、M1-01 收尾、M1-02/03/05、M2-01/03/04、M3-01/02/03）全部移交 Grok。本文件不再新增任务，仅作历史与证据。M0-01 清点表经 Claude 审阅后作为 Grok 清理依据。


## GPT继续开发与复核（2026-11-21）

### 本轮完成的代码修改

1. 修复SELL STALE恢复测试计数：旧订单已成功只读恢复，不再误计为新单跳过。提交`70289b09`。
2. STOP文件检查fail-closed：仅ENOENT视为文件不存在；权限和IO异常按停机处理，防止Trader因无法读取STOP而继续下单。新增5项测试。提交`0618df65`、`e356d22d`、`ed687fa2`。
3. 策略3.3备用金极度恐惧线修正为10；C2评分五档按用户确认继续保留代码数值。新增阈值11边界测试。提交`5d5a90dc`、`06ad448d`、`2a3607e6`、`eb490bdb`。
4. 策略周线口径修正：企稳以已收盘周线close与前周high比较；BTC牛熊状态以最近已收盘周线close判断；追踪止损按持仓后最高周收盘价计算并按周收盘触发；买入前的周收盘价不得作为持仓峰值。Mock行情同步改为最近完整周线，示例买入场景调整。提交`1b038110`、`a342db64`、`5a3a77c3`、`0b4f4132`、`6d9233e2`、`9dea2a98`、`d2eff033`、`8316db72`。

### 最新验收

- HEAD：`8316db7237b9044230bde72b923784951cb5ac17`。
- GitHub Actions Run `44891236638`：**78 files / 555 tests通过**；TypeScript typecheck通过；Next.js production build通过。
- STOP相关Run `44890916534`、`44890919274`、`44890922303`均success。
- SELL测试修复Run `44890853395` success。
- 策略配置/矩阵相关最终Run `44890982578`、`44890996691`、`44890999820` success。

### 尚未完成的真实环境项目

- Testnet真实BUY/SELL、部分成交续卖、超时/429/5xx、真实进程强杀与恢复、72小时运行报告：需要用户本机专用Testnet Key与运行环境。
- Simple Earn服务端赎回适配器尚未实现，继续默认关闭；不得在未完成幂等与历史对账前开放。
- SMTP真实投递未验证；连续故障熔断邮件联动尚未接入。Outbox目前主要承载已确认成交通知。
- M0-01旧通知API仍有可选Cloudflare Access/Worker分支，需先核对调用链后清理。
- 12个工作表的Excel逐项独立核验和Claude最终验收仍未完成。
- production模式继续硬拒绝；不能宣称当前已达到“只换真实Key即可实盘”。


### GPT补充：熔断一次性触发与Testnet运维文档（2026-11-21）

- `ConsecutiveFailureBreaker.recordFailure()`改为仅在首次跨越阈值时返回true，避免达到阈值后每个失败周期反复写STOP/重复执行熔断副作用。
- 单测覆盖阈值触发、后续失败不重复触发、成功清零。Run `44891380475`通过。
- `.env.example`增加 `TRADER_CIRCUIT_FAILURES=5`；`docs/运维手册.md`增加dry-run与Testnet真实订单启动方式、提现权限关闭提醒及production硬拒绝说明。
- 最终文档CI Run `44891430947`通过：tests、typecheck、build均成功。
- M3-03异常/熔断邮件仍待实现；M3-04 Simple Earn仍关闭；M2 Testnet订单与72小时验收仍需用户本机Testnet环境。


## GPT本轮继续开发：故障告警与人工复核自动停机（2026-11-21）

- 新增系统告警Outbox事件类型`system_alert`，复用SQLite通知队列的租约、围栏、退避和人工复核状态；无schema迁移，使用已有JSON payload表。
- 新增`enqueueSystemAlert`、`countExecutionManualReview`；计数覆盖BUY intent `manual_review`与SELL事件`blocked`。
- 新增`TRADER_ALERT_MAIL_ENABLED`和`dispatchTraderAlertMail`，和成交通知独立启用；Outbox根据启用类型领取，防止错误消费未启用类型。
- Trader连续失败达到阈值时先写STOP，再持久化故障邮件；告警邮件失败不会中断Trader交易循环，交给Outbox重试。
- 发现BUY对账进入manual_review后原循环可能继续扫描新信号，已加guard：人工复核期间不创建新BUY；Trader检测已有人工复核/SELL blocked时自动off新订单并继续旧订单只读恢复。
- SELL阻断时写STOP并将原因持久化告警。
- GitHub Actions Run `44895391448`：79 files / 564 tests passed，typecheck与production build passed。
- 真实SMTP仍需用户本机填入SMTP配置并设置`TRADER_ALERT_MAIL_ENABLED=1`后实测；当前默认0，不会发信。此项代码通过不代表SMTP已真实投递。
- production仍硬拒绝；M2 Testnet、Earn、Excel全表核验和Claude验收仍未完成。


### GPT补充：Outbox事件类型隔离修复（2026-11-21）

- 修复系统告警与成交Outbox混合时的队列饥饿：SQLite在LIMIT前按事件类型过滤，成交邮件与故障告警开关互不抢占未启用类型。
- 损坏JSON通过`json_valid`安全识别并转人工复核，避免`json_extract`异常中断整个Outbox领取。
- 新增15条旧成交积压场景测试，确保单独启用告警时仍能及时领取告警。
- CI Run `44895636959`：79 files / 565 tests通过；typecheck/build通过。
- 最新HEAD：`f672ffdf1a3b72dd63bb10872b3107f5da3cd145`。

## 2026-11-21｜Trader人工复核计数漏项修复

- 复核 lib/execution/server/sqlite-store.ts 发现：countExecutionManualReview()只统计 order_intents.manual_review 与 sell_events.blocked，没有独立统计 reservations.manual_review。
- 正常 markManualReview 事务会同步更新intent和reservation，但数据库损坏、旧版本状态或人工修复造成孤立reservation时，Trader可能漏掉该人工复核状态。
- 已将 reservations.state='manual_review' 纳入停机计数；纯通知Outbox的manual_review不纳入交易停机计数，避免邮件投递失败被误判成订单风险。
- 新增 system-alert-outbox.test.ts 回归用例：intent保持queued而资金预留为manual_review时，必须返回非零人工复核计数。
- 提交：686abb159ade4c3e47540fd55d865ffeafc921b8、8d1ba294b3b93dbc2c73578d436ff0db05317010。等待最新GitHub Actions验证；未声称测试已通过。
- 后续补充反向回归测试：纯 notification_outbox.state='manual_review' 不增加交易人工复核计数，避免SMTP失败或通知载荷损坏误触发交易停机。提交：15c9ea0d0c17e50a575178651854299d4013cf8f；等待最新CI。

## 2026-11-21｜资金预留与账户锁一致性审查修复

- 审查scripts/trader.ts确认主循环每轮先调用countExecutionManualReview()；计数非零时先写data/STOP，再以off模式运行只读恢复，禁止新BUY/SELL。
- 进一步发现reserved资金预留与账户锁不一致时，原计数逻辑可能漏检；claimIntent会拒绝新领取，但系统可能持续空转而不报警。
- 已补充一致性检查：reserved reservation必须对应有效的执行中intent和匹配account_lock(singleton=1,intent_id,attempt)；account_lock反向也必须对应同attempt且处于执行中的intent。任何不一致都会触发安全停机计数。
- 新增SQLite测试：queued intent + reserved reservation + 缺失account_lock必须返回非零计数。
- 提交：6c0fc91797685f64317d61f5ec29bb1bacc0bd95、399907566bffd8617d072798b93c405692a71436。等待CI；尚未宣布通过。
- 增加正向回归测试：intent=reserved、reservation=reserved、account_lock(singleton=1且intent/attempt匹配)时 countExecutionManualReview()必须为0，验证新安全检查不会误伤合法在途订单。提交922082c73df197e14cd5e5f47d3f79a211ba46f6；等待CI。


## 2026-11-21｜用户确认限价偏移0.5%，简化买卖执行

- 用户确认BUY限价在当前价基础上+0.5%，SELL限价在当前价基础上-0.5%，明确不采用1%。
- 目标改为LIMIT GTC挂单、定时查询订单、只按交易所真实逐笔成交更新成交CSV；未成交不写CSV，部分成交只写新增fill，撤单/过期也先最终查单再记账。
- CSV目标从“待买入订单导出”改为“真实成交台账”；SQLite只保留未完成订单和tradeId去重索引等必要状态。
- 不再引入普通订单人工审批；但保留clientOrderId查单恢复，防止POST超时/进程重启造成重复下单或漏记成交。
- 本轮先完成规则记录与任务拆分；尚未改动下单代码，当前仍为MARKET实现，不能宣称LIMIT改造完成。
- 下一步：改造Binance LIMIT GTC接口（PRICE_FILTER/tickSize），迁移Trader BUY/SELL调用，增量成交fill写CSV并用SQLite唯一键去重；新增单测与Testnet实测。
- 生产模式继续硬拒绝，直到Testnet真实挂单/部分成交/撤单/重启恢复验收。

## 2026-11-21｜按用户最新要求收敛邮件与订单流程

- 用户明确：只需要策略分数达到条件时发信号提醒，以及买入/卖出真实成交后发邮件；不需要邮件审批或复杂通知平台。
- 信号邮件阈值按策略3.3已记录口径：积极型55分、保守型75分。信号邮件写明分数和触发条件，明确它不是成交通知。
- 买入/卖出邮件只在Binance确认真实成交后发送；买入邮件包含计划/实际成交金额、数量、均价、手续费和剩余待买金额；卖出邮件包含原因/档位、成交金额/数量、均价、手续费、实现盈亏和剩余持仓。
- 用户不需要自动撤单/过期订单业务流程。限价单仍需最小状态查询、部分成交入账和未知结果按原clientOrderId恢复，以避免重复下单及虚报成交；不建设复杂撤单审批。
- SMTP只需简单发送能力与用户邮箱实际收发验证；不把独立故障告警邮件平台或多层Outbox审批作为业务目标。邮件失败不得伪报sent，也不得把普通通知失败变成交易审批。
- 下一步按此范围修订需求清单和Grok任务；核心LIMIT GTC及成交CSV代码仍未完成，本记录不代表代码已实现。


## 2026-11-21 GPT继续开发：0.5% LIMIT GTC与真实成交CSV

- 新增 `lib/execution/server/limit-order.ts`，使用BigInt定点数处理0.5%限价、tickSize方向取整、stepSize数量取整、USDT预算换算基础币数量和名义金额计算。
- `lib/binance.ts`新增Trader专用 `submitTraderSpotLimitOrder`；原 `submitTraderSpotMarketOrder` 兼容名称改为转调LIMIT GTC实现，避免Trader BUY/SELL调用链误走MARKET。
- 限价入口读取Binance原始字符串现价，避免先转Number后出现小币种科学计数法；下单前重新核验PRICE_FILTER、LOT_SIZE、NOTIONAL、账户可用余额。
- BUY按预算计算LIMIT数量并按LOT_SIZE向下取整；SELL不允许静默缩减策略授权数量。
- 新增 `lib/binance.limit-order.test.ts` 与 `lib/execution/server/limit-order.test.ts`。
- `lib/execution/csv.ts`新增真实TradeLedgerEntry CSV导出；`scripts/trader.ts`每轮从SQLite成交台账原子同步 `data/trades.csv`，SQLite仍为事实来源。
- 开发过程中GitHub Actions先后发现正则转义和CSV源码转义问题，已修复；最终验收以最新HEAD的CI为准。
- **未完成边界**：BUY GTC订单处于NEW/PARTIALLY_FILLED时的增量fill入账仍需开发/验证；Testnet真实挂单/成交/部分成交/重启恢复尚未做；SMTP真实投递未验证；生产模式继续硬拒绝。


### GPT补充：Trader内置信号邮件（2026-11-21）
- 检查发现项目已有`runScoreMailNotify`，默认分数门槛核心55/山寨75，支持冷却去重和SMTP发送；此前主要由看板API调用，不在Trader主循环里。
- 已将该函数接入`scripts/trader.ts`，仅对Binance真实且非STALE看板执行；发送失败捕获并记录日志，不影响自动交易。
- 信号邮件正文评分满分由旧90修正为当前策略3.3的100分制。
- `.env.example`核心门槛改为55、山寨75，`MAIL_REQUIRE_STABLE=0`，`TRADE_FILL_MAIL_ENABLED=1`；已有`.env.local`需手动对照配置。
- 真实SMTP投递未验证；BUY GTC未终态部分成交的增量入账仍是待开发项。


### GPT继续完成BUY GTC部分成交入账（2026-11-21）
- `buildBinanceReconcilePlan`不再对所有NEW/PARTIALLY_FILLED订单直接返回wait；现会完整读取myTrades并校验逐笔成交数量/金额与Binance累计值。
- 新增SQLite `recordConfirmedBuyFill`：校验intent/attempt、原订单ID、账户租约、scheduler租约、冻结底仓比例、USDT预留和累计消耗；原始十进制成交字段直接落库。
- BUY新增fill在同一SQLite事务写入fills、trade_ledger和confirmed_trade_fill Outbox；tradeId唯一键防重，冲突数据拒绝覆盖。
- Trader对正常开放GTC订单使用15秒defer调度，重置故障重试计数，不释放资金预留/账户锁，也不因正常挂单转人工复核。
- 新增SQLite集成测试：部分成交真实fill入账、重复tradeId幂等、成交邮件Outbox、资金锁保留、开放订单延后调度。
- CI Run `44912627106`成功：81个测试文件/579个测试通过，typecheck和Next build通过。
- 未完成：完整NEW→多笔PARTIALLY_FILLED→FILLED生命周期测试、SELL开放订单验收、Cloudflare dispatcher是否实际使用的核对、Testnet真实订单/重启恢复和SMTP实投验证。


### 成交邮件内容与SMTP开关补充
- 成交邮件现包含真实逐笔fill数量、成交价、成交金额、手续费资产/金额、USDT手续费折算、Binance orderId/tradeId和成交时间。
- Outbox dispatcher已把这些字段完整传递给SMTP邮件模板。
- `isTradeFillMailEnabled`现在同时要求开关开启和SMTP配置完整；SMTP尚未配置时不领取Outbox事件，避免空配置导致重试耗尽。
- CI Run `44913252848`成功：81 files / 580 tests，typecheck与Next.js build通过。
- 仍待补充邮件业务字段：BUY计划金额与剩余待买金额；SELL卖出原因、实现盈亏和剩余持仓。


### GPT继续完善SELL限价与开放部分成交（2026-11-21）
- 发现服务端SELL预检错误地优先读取`MARKET_LOT_SIZE`；LIMIT GTC应使用`LOT_SIZE`。已修正`lib/execution/server/sell-execution.ts`的`toMarketRules`，缺少LOT_SIZE时直接拒绝，不再回退到市价单数量规则。
- 回归测试特意设置`LOT_SIZE.stepSize=0.001`、`MARKET_LOT_SIZE.stepSize=0.01`，验证策略授权数量0.205按LIMIT规则提交，不被错误缩减。
- 新增SELL开放订单`PARTIALLY_FILLED`测试：按原clientOrderId查单、读取完整myTrades、核验累计成交量/金额后即时调用SQLite真实成交写入；事件保持只读对账状态，不会在订单未终态时创建续卖或重复POST。
- SQLite已有SELL成交幂等测试：相同tradeId第二次写入返回recorded=false；相同ID但成交内容或卖出分类不同则拒绝覆盖。
- 自动Trader主程序`scripts/trader.ts`现直接引用`submitTraderSpotLimitOrder`，不再使用旧兼容名称。
- 已将遗留`/api/binance/spot-order`和`/api/binance/testnet-order`改为HTTP 410永久停用，并把两组路由测试改为验证拒绝请求，防止旧MARKET下单入口绕过本地Trader。路由最终HEAD的CI仍待完成。
- SELL补强CI Run `44913742185`：81个测试文件、582个测试通过；typecheck、Next.js production build通过。该Run对应HEAD `a1aa82c67971e292c2454ae53416831a04038fac`，不包含随后旧路由停用提交。
- 未完成：最新遗留路由停用HEAD CI；Testnet真实订单/部分成交/重启演练；72小时运行；SMTP真实投递；Grok/Claude独立复核。生产继续硬拒绝。


### 最新遗留市价路由封闭验收结果（2026-11-21）
- 现货旧市价路由与Testnet旧市价路由均已HTTP 410停用；两个路由测试均已改为断言410，避免遗留测试继续期待市价下单。
- 最新代码HEAD `2dcf4d2edd130c28ee27271ad691a614b96594d0`对应GitHub Actions Run `44913913471`已成功：81个测试文件、572个测试通过；TypeScript typecheck和Next.js production build全部通过。
- 572与此前SELL补强Run的582测试数量不同，是因为两个旧市价路由原先各自的多项认证/请求测试改为单项永久停用测试；不是测试失败或被跳过。
- 该结果仍仅证明CI自动化验证通过；Binance Testnet真实订单和成交、72小时连续运行、SMTP真实收发及独立复核仍未完成。

## 本轮完成：策略档位持久化与成交邮件业务快照（2026-11-21）

- 沿真实策略信号入口追踪到`buildServerBuyIntents`，将`action.kind`的`head/add/reserve`显式保存到BUY intent。
- SQLite schema v4新增`order_intents.strategy_tier`。新BUY创建和领取强制校验档位；旧库升级时缺少档位的queued BUY进入manual_review，防止旧订单未经确认被自动提交。旧版已在途订单允许真实成交入账，档位邮件标为未知。
- `sqlite-store.ts`的BUY真实fill事务计算计划金额、累计成交数量/金额/USDT手续费、均价和剩余预算；使用BigInt十进制累计与扣减。
- SELL真实fill事务按同一orderId累计数量/金额/手续费/均价，并重放完整trade_ledger取得实现盈亏和剩余持仓。若账本不完整，快照中的盈亏/持仓置空，邮件显示无法核算；不会因此回滚已确认SELL fill。
- 终态核对保留首次入账时的Outbox业务快照，仅校验交易所成交事实，避免快照被空白事件覆盖。
- 增加Outbox重启后快照一致、SMTP失败后重试邮件正文一致的测试。
- 最新HEAD `50d8e3610292f52c33d054808b42fee1372fd104`，CI Run `44917328323`成功：81个测试文件、575项测试通过，TypeScript typecheck、Next.js production build通过。
- 仍待：Testnet真实BUY/SELL和部分成交/重启实测、SMTP真实邮箱收件验证、策略3.3 Excel逐表核对、Grok/Claude独立最终验收、生产API权限/IP白名单与分阶段小额实盘演练。生产模式继续硬拒绝；不要求72小时连续运行。

## 策略3.3工作簿对照与周线决策修正（2026-11-21）

- 逐表读取Library中的`策略3.3.xlsx`（12个工作表），发现代码原MA评分为30/24/18/12/6，F&G评分档位也与工作簿不一致。
- 已按工作簿修正MA五档30/25/20/15/10、F&G≤10/20/30/40为30/25/20/15，>40为0。
- 已修正`strategy/engine.ts`：最后已收盘周线close是策略决策价，周内spot不再混入周线评分、买入触发或卖出触发；执行适配器仍独立读取实时行情。
- 信号邮件脚本满分文案改为100；MAIL_MIN_SCORE_CORE/ALT的55/75保留为独立邮件提醒门槛，实际买入许可仍按策略61/83及高分头仓89/100判断。
- 按策略3.3 G2，BUY intent生成不再单纯因Dashboard STALE标记被拒绝；Mock、未知账户、策略blocked、关键字段缺失仍拒绝。信号邮件保持真实Binance非STALE限制；SELL因卖出数量依赖有效持仓快照，继续要求数据新鲜。
- 最新HEAD `524b360cf86d198ca4b1325fda9a40e77a51cb45`，Run `44917968577`成功：81文件、578测试通过，typecheck/Next build通过。
- 发现尚未闭环：Excel资产池的逐币白名单和六项基本面状态没有在当前BUY策略链完整建模。已交Grok独立核查，不把未审核资产默认为通过；H项未确认内容不擅自启用。

## 周线买卖触发专项回归测试（2026-11-21）

- 新增测试证明：即使周内spot price与周线close不同，买入补仓触发与卖出止盈触发仍以最近已收盘周线为准。
- 最新代码HEAD：`9c484af66fd34fa432891dedba974e4075ce1448`。
- CI Run：`44918408437`成功，81个测试文件、580项测试通过；TypeScript typecheck与Next.js production build通过。
- [查看CI](https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44918408437)

## 修复真实Outbox投递遗漏（2026-11-21）

复查完整SMTP投递路径时发现：Outbox事件已经冻结`businessSnapshot`，但`notification-outbox-dispatcher.ts`调用`dispatchTradeFillMail`时漏传该字段，导致真实邮件正文无法显示BUY计划/累计预算及SELL实现盈亏/持仓。已补传，并新增`notification-outbox-dispatcher.test.ts`断言；同时修正旧订单策略档位为null时的邮件类型兼容。

最新HEAD `ae827e29f5496db4e001e72d0e6629ea8300a86d`，CI Run `44918697059`成功：81文件、580项测试通过，typecheck/Next build通过。

## 策略3.3资产白名单与六项基本面BUY gate（2026-11-21）

- 读取Library中的《策略3.3.xlsx》资产池：BTC/PAXG白名单“通过”，六项基本面风险均“否”；ETH“待审核”；ALT-2/ALT-3是占位符；BNB/UNI没有已审核记录。
- 新增watchlist配置字段：白名单状态 + 六项风险（项目停更、下架/流动性枯竭、未解决重大安全事件、30天内大额解锁、重大监管/法律风险、竞争力/需求持续恶化）。
- BTC/PAXG显式审核通过；ETH pending；BNB/UNI及未登记symbol默认拒绝；CL signal-only。
- Dashboard仅对新增BUY动作添加blocked，不干扰SELL；Trader服务端再次调用isBuyAssetEligible独立拦截，防止伪造无blocked信号绕过。
- 新增资产配置测试与Trader伪造BUY绕过测试。
- HEAD `c1be2e818a52a88a3b6a26bc18e1932f71aa84e7`，CI Run `44919199265`成功：81文件、581测试通过，typecheck/build通过。
- 后续如用户要启用ETH/BNB/UNI，需先在配置里明确白名单通过并填写六项风险结果；不能默认放行。

## 邮件配置一致性修复与验收（2026-11-21）

- .env.example中成交邮件开关修正为默认关闭：TRADE_FILL_MAIL_ENABLED=0，避免复制示例配置后误以为真实邮箱已经验证。
- 策略信号邮件脚本 scripts/notify-score.mjs 现在按 .env.local 优先、.env 兼容的顺序读取配置；移除代码内硬编码的默认收件邮箱；SMTP_HOST必须由配置提供。
- .env.example增加 MAIL_AUTO=1；运维手册明确策略信号邮件由Trader主循环触发，Trader在dry-run/Testnet且真实Binance非STALE时按55/75分门槛检查，无需另开notify进程。成交邮件需要配置SMTP后明确设置 TRADE_FILL_MAIL_ENABLED=1。
- 最新HEAD a9665ef8dd57a0d090cc43dad66018971b550aa1，Run 44919447873成功：81文件、581项测试通过，typecheck与Next.js production build通过。
- 真实SMTP投递仍需用户配置自己的SMTP凭证和收件地址后验证；未在仓库或对话中写入真实密码。
