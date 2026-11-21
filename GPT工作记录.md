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
