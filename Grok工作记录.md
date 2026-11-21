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
