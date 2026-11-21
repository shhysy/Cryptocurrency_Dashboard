# Grok工作记录

## 自验收（2026-11-21）

在干净 `gpt` 克隆上执行：

| 检查 | 结果 |
|------|------|
| `npm test` | **72 files / 505 tests** 通过 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| DO/Cron 纯实现文件 | 已删除 |
| SELL 01A 先按键收集 | 代码在 |
| qty=0/NaN 冲突测试 | 已补推 |
| Trader SELL 入队 | `scripts/trader.ts` 调用 `enqueueServerSellSignals` |
| 生产模式 | 启动路径明确拒绝真实资金 |
| 运维手册 | `docs/运维手册.md` 存在 |

### 结论

**代码侧交付项自验收通过。**  
非代码依赖项（Testnet 真实订单号、SMTP 真发、生产放行）仍须用户环境，不标记为已完成。

### 安全

生产 BUY/SELL、Earn、成交通知默认关闭。


## GPT独立复核（2026-11-21，基于分支 HEAD d0fb1c8）

> 本节为 GPT 对仓库现状的独立核对，不替代 Claude 最终验收。Grok 的 72 files / 505 tests、typecheck、build 自验收已由 GitHub Actions Run 44874836137（HEAD d0fb1c879f0a8b429db06ef41ceace614adfc83c）确认全部成功；但 CI 通过不等于自动交易闭环完成。

### 已核实的交付

- 本地 `npm run trader`、SQLite 存储、单实例锁、BUY intent/提交/对账代码存在。
- SELL 01A 的 `indexLedgerFillsForSellKind` 已先按 symbol+fillId 收集全部行，再判重复键冲突，然后校验 qty/side/sellKind。
- `qty=0/NaN` 与有效同键冲突测试已提交。
- `enqueueServerSellSignals` 已将 SELL 信号写入 SQLite。
- production 启动仍硬拒绝真实资金；该保护必须保留。

### 独立复核发现的未完成项（不得标[x]）

1. **M0-02：** 当前 `sell-automation-tick.integration.test.ts` 未见 BTC 冲突时同轮 ETH 仍正常 enqueue 的混合冲突 tick 集成用例；需补齐后再验收。
2. **M0-03：** 规则矩阵只有规则域摘要，未逐条对照 `策略3.3.xlsx` 核对每个待核验项。
3. **M0-04：** README、执行层README、自动化落地路径此前仍写“GPT主责/规划中”，与当前实际代码和Claude移交分工不一致；本次已同步为真实状态。
4. **M1-02/M1-04：** Trader 每轮只调用 `enqueueServerSellSignals`；未调用 SELL 服务端提交/对账处理器。浏览器版 tick 仍依赖 IndexedDB，故关闭浏览器后 SELL 不会完成自动卖出闭环。
5. **M1-03：** BUY unknown/只读恢复代码存在，但仍缺真实文件数据库下的杀进程、重启后只查原 clientOrderId 的端到端证明。
6. **M1-05：** 未见只读看板完整展示 Trader 状态、最近订单/成交、对账时间和人工复核项的验收证据。
7. **M2-01~M2-04：** 未见可核验 Testnet 订单号/异常演练/连续运行报告；需专用 Testnet Key 与用户环境。
8. **M3-02：** 当前启动自检未真实读取账户权限/提现权限，也未实际校验服务器时间偏差、交易所连通与USDT余额。
9. **M3-04：** Earn 服务端方法在开关开启后仍返回“适配器尚未完成”，不能赎回。
10. **M3-05：** `dispatchTradeFillMail` 只生成正文并返回 `sent:false`，尚未接通SMTP发送。
11. **M3-06：** 当前日志脱敏为控制台输出，未见按日轮转文件日志。
12. **M3-07：** 运维手册存在，但需等上述实现完成后再定稿“一键填Key启动”步骤。

### GPT复核结论

- M0-02：原缺口已补充：提交 `a9726b05a30f73aae70962aeda4942be23644f83` 新增“BTC台账同键冲突时只阻断BTC，同轮ETH仍正常入队”集成用例；GitHub Actions Run `44876002637` 的 test/typecheck/build 全部成功。仍待 Claude 最终独立验收。
- M0-03/M0-04：M0-04文档已在本次提交同步；M0-03仍未完成。
- M1：**未通过“关闭浏览器自动买卖”验收**，SELL服务端处理链路缺失。
- M2：未开始/阻塞于专用Testnet实测。
- M3：未通过生产预检验收；生产硬拒绝必须保留。
- 当前不得向用户宣称“只填真实Key就能实盘自动交易”。


### GPT补充提交证据（2026-11-21）

- M0-02混合冲突集成用例：`lib/execution/sell-automation-tick.integration.test.ts`。
- 提交：`a9726b05a30f73aae70962aeda4942be23644f83`。
- GitHub Actions Run：`44876002637`，结论 success；Run中 Run tests、TypeScript typecheck、Next.js production build 均成功。
- 该测试验证BTC同一fillId存在有效qty与qty=0冲突行时，BTC止盈续卖被阻断，而ETH在同一tick仍可正常入队。M0-02待Claude确认后才能标记[x]。


## GPT继续开发与独立验收（2026-11-21）

### 本轮新增实现

1. `lib/execution/server/sell-execution.ts`：SELL服务端执行与只读对账；由本地Trader调用，不依赖IndexedDB。
2. SELL预检：以SQLite成交台账重放持仓，并与Binance free/locked余额核对；使用交易所MARKET_LOT_SIZE/NOTIONAL规则；普通止盈只能使用周期仓，底仓减仓最多按剩余底仓50%核验。
3. SELL提交：提交前在SQLite持久化唯一clientOrderId；响应不明后只读查询原ID，不允许再次POST。
4. SELL对账：验证订单身份、订单数量不超过策略事件授权数量、成交分页完整、逐笔成交与累计数量/金额一致；只有交易所确认的成交写入SQLite成交台账和Outbox。0成交终态不会被误判成可续卖。
5. SELL台账读取异常fail-closed：不创建新SELL事件。
6. Trader Testnet启动要求BUY和SELL服务端开关都开启；SELL链路异常计入连续故障熔断。
7. 启动自检：实际读取账户权限、要求canTrade=true/canWithdraw=false；读取USDT余额；读取Binance服务器时间并检查本机偏差；检查数据目录与SQLite父目录可写。

### 代码验收证据

- GitHub Actions Run `44879348229`：73 files / 515 tests通过；TypeScript typecheck通过；Next.js production build通过。
- Run覆盖SELL执行与对账Mock测试、启动自检测试。**Mock不是Testnet实盘订单证据。**
- 随后追加的Trader熔断传播提交：`2625db3f0bec5640f7f7231f762601a25534cae5`；其后的最新HEAD CI待完成。
- 最新分支在本次工作结束时需要再核对，不能用旧CI替代最新提交的CI。

### 未完成及安全边界

- M1-04：服务端SELL代码已接入，但真实Testnet SELL、部分成交续卖、订单超时/重启演练尚未通过。
- M1-03：BUY/SELL进程级kill/restart验收仍缺。
- M1-05：只读执行看板未完成。
- M2：专用Testnet BUY/SELL、异常演练与72小时报告未完成。
- M3-04：Simple Earn服务端赎回未实现，继续关闭。
- M3-05：SMTP未真正发送，Outbox不得假报sent。
- M3-06：日志按日轮转未实现。
- production仍硬拒绝；真实Key不应粘贴到聊天或提交仓库。


### SMTP Outbox继续开发（2026-11-21）

- SQLite Outbox repository：双连接原子领取、租约fencing、成功标记、失败指数退避，10次失败进入人工复核。
- 新增本地SMTP直发，只有`TRADE_FILL_MAIL_ENABLED=1`才发送；SMTP主机/端口/邮箱地址校验，15秒响应超时。Outbox dispatcher已接入Trader。
- 最新CI Run `44880232514`：74 files / 521 tests、typecheck、build全部通过。
- Mock测试覆盖Outbox并发领取、SMTP发送适配调用、发送失败退避和关闭开关；没有使用用户真实SMTP账号，不能声称真实邮件送达。


### M3-06日志轮转继续开发（2026-11-21）

- Trader日志已从仅控制台输出升级为脱敏后按UTC日期落盘：`data/logs/trader-YYYY-MM-DD.log`。
- 日志目录0700、日志文件0600；默认目录已加入.gitignore，支持`TRADER_LOG_DIR`配置。
- 测试覆盖文件落盘和API Key/签名脱敏；CI Run `44880508488` 74 files / 522 tests、typecheck/build通过。
- 尚未验证用户机器磁盘空间和日志保留策略；未做自动清理旧日志，避免擅自删除审计记录。


### M3-01统一Trader模式继续开发（2026-11-21）

- Testnet BUY/SELL授权由`AUTO_TRADE_MODE=testnet`派生，Binance Testnet环境自动选择，不再要求用户额外设置两组Testnet订单开关或`BINANCE_SPOT_ENVIRONMENT`。
- 新增Trader专用下单函数；浏览器API仍保留显式服务端开关，不会因为Trader模式而自动放开浏览器下单入口。
- production仍由`scripts/trader.ts`硬拒绝；即使设置`AUTO_TRADE_MODE=production`和确认变量，也不会执行实盘订单。
- 新增5项模式授权单测；待最新CI确认。


### GPT修复STOP下SELL只读恢复缺口（2026-11-21）

- 复核发现：Trader检测到`data/STOP`后切换`off`，旧SELL事件之前会被`runServerSellCycle`直接跳过；行情STALE也会在旧订单查单前提前返回。这与“停止新订单但继续只读恢复”的安全语义不一致。
- 已修复：`off`模式仍查询原`clientOrderId`并核验旧SELL订单；不读取行情快照也能恢复；只有`testnet`且行情/account快照有效时才允许处理新SELL事件。
- Trader循环已调整：STOP时不再生成SELL新信号，但仍调用SELL只读恢复；BUY原有只读对账路径保留。
- 新增回归测试：STOP/off模式恢复旧SELL且不POST；行情STALE时仍先恢复旧SELL，再拒绝新卖单。
- 代码提交：`31830362`、`4725ba7f`、`a0be32c1`、`e594cd31`、`3579ea7a`、`6280f5e3`。其中Run `44885859526`验证到`3579ea7a`：75 files / 528 tests、typecheck、Next build通过；最新增加的STALE回归用例在`6280f5e3`，等待包含该SHA的CI。
- 不宣称Testnet实盘完成；production仍硬拒绝。


### GPT清理Cloudflare残留代码（2026-11-21）

- 仓库递归文件树仅发现两个旧Cloudflare Access验证文件，GitHub代码搜索未发现引用；已删除模块及对应测试。
- 删除后重新检查完整Git tree：无Cloudflare、Workers、Access、Wrangler、Durable Object、Cron相关文件路径。
- GitHub历史检查仍出现外部`Workers Builds: cryptocurrency-dashboard`，它不是当前仓库代码树文件；M0-01仍保留[~]，需仓库管理员在集成设置核对是否解绑。


### M0-01 Cloudflare清理复核纠正（2026-11-21）

- 尝试删除旧Cloudflare Access验证模块后，CI明确报错：`app/api/trade-fill-notifications/route.ts`仍依赖该模块（TS2307），证明旧通知中转路由仍在代码中引用。
- 已恢复Access验证模块及测试，防止构建失败。
- 本地Trader成交通知已走SMTP Outbox；旧API路由的可选Worker/Access分支仍需确认是否有旧客户端调用，不能贸然删除。
- M0-01保持进行中，后续先追踪调用链，再做完整移除。



### GPT继续开发：SQLite重开后unknown订单只读恢复集成测试（2026-11-21）

- 在`lib/execution/server/sqlite-store.test.ts`新增真实文件SQLite集成用例：创建BUY intent、claim资金预留、持久化原`clientOrderId`、标记unknown、关闭数据库连接，再重新打开同一数据库文件。
- 重启后的正式`runTraderCycle(mode="off")`读取待对账任务，并通过只读适配器按原`clientOrderId`查询；测试明确断言查询参数与原订单一致、提交函数调用次数为0，且unknown状态与原ID仍持久化。
- GitHub Actions Run `44887231223`：Run tests、TypeScript typecheck、Next.js production build全部通过。
- 提交：`8725454188`（测试完善），前置测试提交`8006213895`。
- **验收边界：** 这是文件数据库关闭/重开 + 正式Trader循环的集成测试，不是操作系统级SIGKILL进程演练。M1-03仍为[~]，下一步需补子进程被强制终止后重启的端到端验证；不能把本测试说成完整kill/restart验收。
- M1-05尚未修改：当前`ExecutionStatusPanel`仍读取浏览器IndexedDB，不能代表本地Trader SQLite状态。后续先实现只读状态投影与本机访问保护，再替换看板数据源。



### GPT继续开发：M1-05本地Trader SQLite只读看板（2026-11-21）

- 新增`lib/execution/server/trader-status.server.ts`：直接读取已有SQLite文件，使用只读连接，不创建数据库、不执行schema迁移；展示Trader锁PID/启动时间/心跳（不返回随机token）、STOP标记、运行模式、BUY intent、SELL事件、成交台账、资金预留和通知Outbox状态。
- 新增`app/api/trader-status/route.ts`：必须显式设置`TRADER_STATUS_API_ENABLED=1`；仅允许localhost/127.0.0.1/::1 Host，拒绝Forwarded/X-Forwarded请求头；要求Next.js服务绑定loopback，禁止公网反向代理暴露。
- `components/ExecutionStatusPanel.tsx`已改为每15秒读取本地Trader状态API；读取失败不会回退到浏览器IndexedDB冒充真实Trader状态；区分BUY金额与SELL数量单位。
- 新增`lib/execution/server/trader-status.server.test.ts`：验证数据库不存在时不创建空库、读取真实SQLite订单、STOP/心跳展示、锁token不泄露及读取不修改订单状态。
- GitHub Actions Run `44887541409`（HEAD `436aaa0a5610fd1722f51b67442ecac9c14039f4`）：测试、TypeScript typecheck、Next.js production build全部通过。
- 运维手册已补充启用步骤：`TRADER_STATUS_API_ENABLED=1`，使用`npm run dev -- --hostname 127.0.0.1`并在同一机器/目录启动Trader。
- **验收边界：** 代码和CI测试通过；仍需用户本机实际启动Next.js与Trader，确认PID/心跳/STOP/订单/成交数据展示正确。接口默认关闭，不可通过公网或代理访问。M1-05保持[~]，待本机验收。



### GPT补齐M1-03：真实子进程SIGKILL与重启恢复（2026-11-21）

- 新增`lib/execution/server/trader-restart-child.ts`测试夹具及`sqlite-store.test.ts`进程级集成测试。
- 测试启动独立Node子进程，使用真实SQLite文件创建BUY intent、持久化原`clientOrderId`、写入unknown状态；父进程对其执行`SIGKILL`，再启动第二个Node子进程打开同一数据库并运行正式`runTraderCycle(mode="off")`。
- 重启子进程只调用只读`findOrderByClientOrderId("BTCUSDT", 原clientOrderId)`；测试断言查询ID与原ID完全一致、订单仍为unknown、下单函数调用次数为0。
- 过程中的首轮测试暴露夹具问题：未决Promise不会保持Node事件循环，子进程提前退出导致SIGKILL断言失败。已在夹具中加入保持进程存活的定时器，修正后重新跑完整CI。
- 最新GitHub Actions Run `44887848264`，HEAD `b39ef69912a2578403bb829051bdf7f8cb818520`：**77 files / 536 tests通过**，TypeScript typecheck通过，Next.js production build通过。另新增状态接口Host/Origin/反向代理头访问边界测试。
- **结论：** M1-03所要求的SQLite文件 + OS级进程强杀 + 重启后按原clientOrderId只读恢复、不重复POST，已具备自动化集成测试证据；任务状态仍等待Claude独立复核，不抢先标[x]。此测试使用模拟只读交易所响应，不等于Testnet真实订单演练（M2）。



### GPT安全复核：移除浏览器自动交易循环，避免双执行器（2026-11-21）

- 复核发现旧`ExecutionBackground`仍会在浏览器打开时运行IndexedDB BUY/SELL后台节拍；如果用户同时启动本地Trader，旧浏览器执行路径会与SQLite Trader形成双执行器风险。
- 已从`components/Dashboard.tsx`移除该后台组件，并删除`components/ExecutionBackground.tsx`。浏览器不再后台自动提交BUY/SELL；本地`scripts/trader.ts`成为唯一常驻自动执行入口。
- 看板中的浏览器队列仍是旧IndexedDB记录/策略预览，不等于本地Trader SQLite订单。旧浏览器队列不会自动迁移到SQLite，也不应再被当作Trader真实执行状态；真实状态以新增的本地SQLite只读面板为准。
- 需要继续核对策略后处理：`Dashboard.tsx`此前通过浏览器IndexedDB的SELL事件/成交台账调用`applyPostTakeProfitRebuy`；本地Trader的`getDashboard`尚未接入SQLite版同一后处理。这是当前发现的策略一致性缺口，下一步必须让Trader和服务端看板统一使用SQLite成交台账，未完成前不能宣称策略3.3完整自动执行。



### GPT修复策略3.3止盈后回补的执行数据源一致性（2026-11-21）

- 复核发现：旧Dashboard曾用浏览器IndexedDB的SELL事件/成交台账调用`applyPostTakeProfitRebuy`，而本地Trader的`getDashboard`只读取基础策略信号，未应用同一后处理。这会导致浏览器显示与Trader真实下单策略不一致。
- 新增`readTraderStrategyHistory`：以SQLite只读连接读取完整`sell_events`和`trade_ledger`，严格校验成交ID JSON、side和关键数值；数据库不存在与数据库损坏分开处理，损坏/不兼容时抛错阻断策略后处理。
- `lib/service.ts`现在对真实Binance Dashboard使用SQLite确认事件/成交台账统一执行`applyPostTakeProfitRebuy`；本地Trader调用同一`getDashboard`，因此顺序止盈与止盈后均价回补使用同一数据源。
- `components/Dashboard.tsx`移除浏览器IndexedDB叠加策略结果；不再以浏览器台账覆盖服务端策略信号。
- 新增测试验证策略后处理可读取SQLite确认SELL事件和成交台账；GitHub Actions Run `44888306511`测试、typecheck、build全部通过。
- 浏览器自动执行器已从Dashboard移除并删除`components/ExecutionBackground.tsx`；浏览器BUY/SELL现货提交开关永久关闭。旧BuyQueue/SellQueue明确标注为浏览器IndexedDB历史记录，不属于Trader SQLite，也不参与自动执行。
- README、执行层README、策略3.3自动化落地路径已同步说明。
- 仍需注意：旧浏览器IndexedDB历史成交不会自动迁移到Trader SQLite；如果当前持仓与服务端买入历史/SQLite卖出台账无法核对，策略后处理会fail-closed暂停相关币种操作，不得手工伪造台账。



### GPT修复本地Trader状态统计并完成最新CI（2026-11-21）

- 状态面板的STOP检测改为文件存在性检查；非ENOENT错误按STOP未知/已触发的保守方式显示，避免权限异常时误报STOP未触发。
- 人工复核数现在合并订单intent、SELL blocked事件、资金预留manual_review与通知Outbox manual_review，不再漏计。
- 首轮CI发现统计变量初始化顺序错误（notificationStates在manualReview之后声明），已调整初始化顺序。此前失败Run `44888489442`及其文档触发的后续Run均为同一缺陷；修复后最终Run `44888644093`通过。
- 最新HEAD `acf4e1992c5258c3064f4daa923d379e567bd473`：**77 files / 537 tests通过**，TypeScript typecheck和Next.js production build全部通过。


## Grok待复核任务（GPT更新，2026-11-21）

请基于当前`gpt`分支HEAD独立复核，不要只阅读工作记录：

1. 审核`strategy/engine.ts`周线收盘口径变更：企稳条件、BTC市场状态、追踪止损峰值和买入前历史周线排除逻辑；确认与策略3.3工作簿一致。
2. 审核`strategy.config.ts`备用金极度恐惧阈值10，确认它与C2评分档位的五档配置彼此独立。
3. 审核`lib/execution/server/stop-file.ts`和`scripts/trader.ts`：只有ENOENT允许继续，其他文件系统错误必须fail-closed；确认不会误停或绕过STOP。
4. 审核SELL每个tick最多提交一笔新订单、STALE时旧订单只读恢复优先的状态机。
5. 使用当前HEAD的CI Run `44891430947`作为代码基线（包含Run `44891236638`的78 files / 555 tests策略/Trader代码验收，以及后续熔断和运维文档修改；最终tests、typecheck、build均通过），不要引用早期失败Run作为最终结果。
7. 额外复核`ConsecutiveFailureBreaker`是否只在首次达到阈值时触发，检查`.env.example`的`TRADER_CIRCUIT_FAILURES`和`docs/运维手册.md`的Testnet命令是否一致。
6. 继续推进尚未完成的Testnet订单演练、SMTP异常/熔断通知联动、Simple Earn服务端赎回设计及M0-01旧通知路由调用链审查。任何涉及真实资金的开关保持关闭，Testnet和实盘证据分开记录。

Grok复核完成后，请在本文件追加逐项结论和证据；不要自行将M2/M3标记完成，真实订单与SMTP投递需要实际运行证据。
