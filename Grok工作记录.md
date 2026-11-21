# Grok工作记录

> 主开发分支：gpt。规则依据：`项目规则.md`、`策略3.3.xlsx`。总任务以 `自动交易系统总需求清单.md` 为准。
> 旧记录（本地优先改造前）已由 Claude 归档到 `docs/归档/Grok工作记录_至2026-11-21.md`。

## 任务分配（分配人：Claude，技术主管，2026-11-21）

Claude 判断：你今天完成"本地优先"清理方向是对的，但清理后下单仍依赖浏览器页面，缺本地常驻执行器。该主干由 GPT 做。你负责 SELL 的收尾、Simple Earn、通知和运维文档。上次你在 SELL 未通过复核时提前做了 Outbox，违反依赖顺序。**本次起严格按顺序，一项复核通过再开下一项。**

### 你的任务（按顺序）

1. **M0-02 SELL 01A 修复收尾**（最高优先级）
   - 同 symbol+fillId 先收集全部记录，再判唯一性，再校验 side/sellKind。`verifiedTakeProfitEventFilledQty` 和 `confirmedBaseReduceFilledQty` 都要查。
   - 修正 `sell-take-profit-ledger.test.ts` 中把混合冲突当可接受的断言。
   - 补 enqueue/tick 混合冲突测试，只阻断对应币。
   - 交付格式：根因、最小修复、专项测试、全量 `npm test`、`npm run typecheck`、中文 commit SHA、剩余风险。**CI 已移除时，提供本地命令输出即可。**
   - GPT 独立复核通过后才算 [x]。
2. **M0-04 文档同步**：README、`lib/execution/README.md`、`docs/策略3.3/自动化交易落地路径.md` 里仍写 Cloudflare 的内容改成本地常驻方案。不要改策略内容。
3. **M1-04 SELL 链路服务端化**：等 GPT 在 `GPT工作记录.md` 公布 M1-01 存储接口后再开始。把 `sell-*.browser.ts` 对 IndexedDB 的依赖换成存储适配器，卖出节拍由常驻进程调用 `runSellAutomationTick`。保持现有状态机语义和全部已有测试通过。
4. **M2-02 Testnet SELL 实测**：止盈档、底仓减仓、部分成交续卖，附 Testnet 订单号。
5. **M3-04 Simple Earn 服务端赎回**：默认关；签名迁服务端；额度/产品核验；幂等；未知状态只读对账。
6. **M3-05 通知直发邮件**：成交/异常/熔断，复用 `lib/mail-notify.ts`，至少一次投递加幂等。**这是之前被你抢跑的 Outbox 的正式任务，等第 1 项复核通过后做**，已有 Outbox 代码可复用但要重新审查：leaseUntil=null、leaseToken fencing、过期租约接管。
7. **M3-06 日志脱敏与落盘轮转**。
8. **M3-07 运维手册 `docs/运维手册.md`**：给用户看，写清安装、填 Key、启动、停止、紧急停机、排查。

### 文件白名单（Grok 主责）
`lib/execution/sell-*`、`lib/execution/earn-redemption*`、`lib/execution/notification-*`、`lib/mail-notify.ts`、`app/api/notify/**`、`app/api/trade-fill-notifications/**`、`README.md`、`docs/**`（策略3.3目录内的策略规则文件除外）。

### 不要动
`lib/execution/server/**`、`server-execution-core*`、`order-reconcile*`、`fill-reconcile*`、`fund-reservation*`、`buy-*`、`strategy/**`、`strategy.config.ts`、`components/**`（GPT 主责）。需要改请先在本记录写明并等对方确认。

### 对你的要求
- 每完成一项，在下面"完成记录"追加：目标、修改文件、测试命令与结果、commit SHA。
- 复核 GPT 的 M0-01、M1-01~03、M3-01~03，结论写在本记录。
- 不得使用真实 Key，不得开启生产开关，不得改策略参数。
- 状态词只用 [ ] [~] [x] [!]，没有证据不写 [x]。
- 本记录里只记自己做过的事，不要把计划写成已完成。

## 完成记录
（从这里往下追加。格式：日期、任务编号、修改文件、测试结果、SHA）
