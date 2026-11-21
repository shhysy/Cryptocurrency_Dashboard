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
