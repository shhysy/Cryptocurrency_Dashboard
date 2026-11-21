# Grok工作记录

> 主开发分支：gpt。规则依据：`项目规则.md`、`策略3.3.xlsx`。总任务以 `自动交易系统总需求清单.md` 为准。
> 旧记录已由 Claude 归档到 `docs/归档/Grok工作记录_至2026-11-21.md`。

## 任务顺序（Claude 分配）

1. M0-02 SELL 01A — 代码已交付，待 GPT 复核  
2. M0-04 文档同步 — 本轮完成  
3. M1-04 — 等 GPT 公布 M1-01 存储接口  
4. 其余按依赖，未开始  

## 完成记录

### 2026-11-21 · M0-02 SELL 01A（[~] 待 GPT 复核）

- **根因：** 台账索引先过滤非 SELL/非目标 sellKind，同键 BUY 与有效行并存时仍接受有效行。  
- **修复：** `indexLedgerFillsForSellKind`：同键先收集全部行 → 多行一律 conflict → 仅恰好一行且 SELL+requiredKind 计入；take_profit 与 base_reduce 共用。  
- **测试：** `sell-take-profit-ledger.test.ts`、`sell-enqueue-ledger.integration.test.ts`、`sell-base-reduce-proof.test.ts`。  
- **本地：** 专项 23 tests 通过；全量 `npm test` 63 files / 499 tests；`npm run typecheck` 通过。  
- **约束：** 未开 Outbox 生产；未启 M3-05。

### 2026-11-21 · M0-04 文档同步

- **修改：** `README.md`、`lib/execution/README.md`、`docs/策略3.3/自动化交易落地路径.md`  
- **内容：** Cloudflare/OpenNext/DO 部署表述改为本地常驻方案；策略参数未改。  
- **下一项：** 等 GPT 公布 M1-01 后再做 M1-04。


## 接手 GPT 全部任务（分配人：Claude，2026-11-21）

GPT 已无法工作，其未完成任务全部归你。GPT 之前的产出（`lib/execution/server/*`：存储接口、`node:sqlite` 存储、Trader 循环、单实例锁，`scripts/trader.mjs`、`scripts/trader.ts`）直接复用，先通读 `GPT工作记录.md` 的"完成记录"再动手。**你现在同时拥有此前 GPT 的文件白名单**（`lib/execution/server/**`、`server-execution-core*`、`order-reconcile*`、`fill-reconcile*`、`fund-reservation*`、`buy-*`、`binance-*`、`strategy/**`、`app/api/**`、`components/**`、`package.json`）。唯一红线仍是：不改策略参数、不碰 Excel。

**验收方式变更：** 你全部做完后，由 Claude 统一验收，不再有 GPT 复核。所以每项必须自带证据（命令输出、SHA），做完全部再通知，不要中途报"完成"。

### 全部待办（按此顺序，前项未通过自测不得跳到后项）

**阶段一：收尾 SELL 与清理（M0）**
1. **M0-02 SELL 01A**：GPT 最后一次复核指出两点必须修：①`indexLedgerFillsForSellKind` 仍先过滤非有限/非正 qty 再按 symbol+fillId 分组，同键有效 SELL 与 qty=0/NaN/负数冲突行并存时冲突行被丢，必须改为先按键收集全部行；②`sell-automation-tick.integration.test.ts` 缺混合冲突 tick 用例，要证明 BTC 阻断时同轮 ETH 仍正常 enqueue。
2. **M0-01 清理 Cloudflare 残留**：Claude 已批准 `GPT工作记录.md` 清点表。执行：删除纯 DO/Worker 代码与 FakeSql 测试（`execution-account-do*`、`scheduler-task-do.test.ts`、`strategy-intent-cron.server*`），但**先把行为用例迁成 `node:sqlite` 测试再删**；保留并复用 `server-execution-core`、`order-reconcile`、`fill-reconcile`、`fund-reservation`、`binance-reconcile*`、`scheduler-task-core`。`cloudflare-access*` 与 `app/api/execution/intents` 在 M3-05 和 Trader 接通后一并删。分批提交，每批全量测试通过。
3. **M0-03 规则矩阵逐项核验**：对照 `策略3.3.xlsx` 把矩阵"待核验"项标为 已实现/有测试/差异。差异只记录，写进 `docs/策略3.3/策略3.3规则实现矩阵.md` 并在你的记录里单列，交 Claude 转用户，不得改参数。

**阶段二：本地常驻执行器（M1）**
4. **M1-01 收尾**：补双独立 SQLite 连接竞争 claim/账户锁、scheduler lease fencing 失败路径、终态重复 fill/Outbox 冲突测试。
5. **M1-02 常驻进程**：`npm run trader` 已有雏形，补齐"拉信号→intent→预检→下单→查单→入账→终态"全循环，SELL 也接入（`runSellAutomationTick`）。单实例锁已有，验证双开被拒。无浏览器可运行。
6. **M1-03 unknown 订单恢复**：POST 超时/断连/无法解析进 unknown，崩溃重启后只按原 clientOrderId 查单，**绝不重发**；用真实文件 DB + 杀进程测试证明。
7. **M1-04 SELL 服务端化**：把 `sell-*.browser.ts` 的 IndexedDB 依赖换成 `store.sellEvents/tradeLedger` 适配器，保留全部既有 SELL 测试。
8. **M1-05 看板只读**：展示 Trader 状态、最近 intent/订单/成交、对账时间、人工复核项；页面不再驱动执行。

**阶段三：生产保护（M3 中原 GPT 项 + 你的原项）**
9. **M3-01 模式开关**：`AUTO_TRADE_MODE=off|dry-run|testnet|production`，默认 off。production 需 `I_UNDERSTAND_LIVE_TRADING=yes`、Key 齐全、自检通过。旧开关由它派生，不得冲突。现有代码里"生产模式尚未验收，拒绝启动"的硬拒绝，在 M3-01/02/03 全部通过自测后才可解除。
10. **M3-02 启动自检**：Key 可读账户、**提现权限必须关**、时间偏差、交易所连通、USDT 余额、数据库可写、单实例锁。失败拒启动并中文提示原因。
11. **M3-03 故障保护**：只做异常熔断（连续 N 次异常/对账失败自动停机并通知）和 `data/STOP` 手动停机。**用户已确认不设单日/单笔上限，不得新增任何限制策略买卖金额或次数的逻辑。**
12. **M3-04 Simple Earn 服务端赎回**（默认关）。
13. **M3-05 通知邮件直发**（复用 `lib/mail-notify.ts`；移除 Worker 与 CF Access 分支）。
14. **M3-06 日志脱敏与按日轮转**。

**阶段四：Testnet 实测（M2，需要用户的 Testnet Key 放进 `.env.local`；没有就写 [!] 并说明，其余先完成）**
15. **M2-01 BUY 实测**、**M2-02 SELL 实测**（止盈档、底仓减仓、部分成交续卖）。附 Testnet 订单号与日志。
16. **M2-03 异常演练**：超时 unknown、429/5xx、杀进程重启、重复成交回执、余额不足、LOT_SIZE/NOTIONAL 拒单。证明未知订单不重复 POST。
17. **M2-04 连续运行 72 小时报告**（如时间不允许，先出至少 2 小时稳定运行日志并明确标注未满 72 小时）。

**阶段五：文档**
18. **M3-07 `docs/运维手册.md`**：给用户看的安装、填 Key、启动、停止、紧急停机、排查、回滚。写明"只改 `.env.local` 的 Key 和 `AUTO_TRADE_MODE`"。

### 规则提醒
- 不使用 Cloudflare，不引入 Worker/DO/Wrangler。
- 不得使用真实 Key，不得开启生产；`production` 相关测试只用 mock。
- 每项完成在"完成记录"追加：目标、修改文件、测试命令与结果、SHA。状态只用 [ ] [~] [x] [!]。
- 中文 commit，推送到 `gpt`。
- 全部完成后，在记录末尾写"全部完成，请 Claude 验收"，附总结表（任务编号→状态→证据）。未完成项必须明说，不要隐瞒。
