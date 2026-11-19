# Grok 工作记录

> 本文件由 Grok 维护。工作说明使用中文（代码除外）。唯一开发分支：`gpt`。

## 冲突检查
已读 `gpt工作记录.md`。预备订单与 `post-take-profit-rebuy` 双轨；不把 CSV 接入自动下单。本轮只改 prep 允许文件。

## 本轮完成（人工计划完善）
- `planKind: manual_prep`、输入校验、`validatePrepPlan`
- CSV 增加 planKind；store 归一化
- UI 标明「人工计划 / 非挂单」
- 测试：`lib/execution/prep-orders.test.ts`

修改文件：`prep-orders.ts`、`prep-orders-csv.ts`、`prep-store.browser.ts`、`prep-orders.test.ts`、`PrepOrdersPanel.tsx`

提交 SHA：
- `3052483b6e0c63da45e2ce9834198d606a50a1c3`（核心）
- `f5cf74e199f784073c40a878777108d80d7cd803`（CSV/store/测试）
- `a4b482c1c7588ea7f6d3920702795d9c5e5b5a32`（UI）

请本地：`npx vitest run lib/execution/prep-orders.test.ts`

未做：自动止盈侦测、接入自动下单（禁止）、与主策略投影合并。


## GPT / Grok 分工约定（2026-11-19）

本轮并行开发统一使用 `gpt` 分支，双方按文件白名单隔离，避免互相覆盖。

### Grok 负责：预备订单人工计划与 CSV
**负责文件：**
- `lib/execution/prep-orders.ts`
- `lib/execution/prep-orders-csv.ts`
- `lib/execution/prep-store.browser.ts`
- `lib/execution/prep-orders.test.ts`
- `components/PrepOrdersPanel.tsx`
- 上述模块直接对应的独立文档和测试。

**工作目标：**
- 完善人工计划生成、输入校验、止盈后重建、回补后触发价刷新。
- CSV 作为导出快照，不作为自动执行真源。
- UI 明确标记「人工计划 / 非交易所挂单 / 非自动执行」。
- 补齐预备订单纯逻辑单元测试。
- 每轮完成后更新本文件，写明修改文件、测试命令/结果、commit SHA、CI URL。

**禁止修改：**
- `components/Dashboard.tsx`
- `lib/execution/fund-reservation.ts`
- `lib/execution/store.browser.ts`
- `lib/execution/buy-order-submit.browser.ts`
- `lib/execution/sync-buy-order.browser.ts`
- 成交台账、资金预留、自动执行开关。

### GPT 负责：资金预留与买入订单恢复安全
GPT 负责资金预留事务、并发预留/认领、部分成交扣减、终态释放、旧 attempt 隔离、IndexedDB 恢复与异常 fail-closed。Grok 不修改以上 GPT 负责文件。

### 共同约束
- 双方均不修改 `components/Dashboard.tsx`，避免共享 UI 冲突。
- 不将 localStorage/CSV 预备订单计划接入自动下单；自动执行真源仍是已确认交易所订单与成交台账。
- 不开启实盘 BUY/SELL，不启用 Simple Earn 自动赎回，不用真实余额测试，不发送真实订单。
- 若必须跨越文件边界，先在双方记录中提出并协商，不能直接覆盖另一方实现。

### 当前 Grok 进度
- 已完成：预备订单增加 `planKind: manual_prep`、输入校验、`validatePrepPlan`；CSV/store 字段归一化；UI 标注「人工计划 / 非挂单」。
- 修改文件与提交 SHA 见本记录「本轮完成（人工计划完善）」章节。
- 当前只报告本地单测命令 `npx vitest run lib/execution/prep-orders.test.ts`；完整 CI 结果需以 GitHub Actions 实际状态为准。


## 新一轮任务分配（2026-11-19，GPT 指派）

Grok 已完成上一轮人工计划任务。本轮增加两条互相独立的任务线，仍统一提交到 `gpt` 分支。

### A. 成交通知 Outbox 全链路可靠性（Grok 主责）
**允许修改文件：**
- `lib/execution/notification-outbox.ts`
- `lib/execution/notification-dispatch.browser.ts`
- `lib/execution/notification-outbox.test.ts`
- `lib/execution/notification-signature.server.ts`
- `lib/execution/notification-signature.server.test.ts`
- `app/api/trade-fill-notifications/route.ts`
- 如需增加 Worker 端协议测试，可新增独立测试文件；不得修改真实 Worker 部署配置或生产密钥。

**目标：**
1. 审核 Outbox 事件构造、字段校验、幂等 ID 和重试退避边界。
2. 审核租约领取、过期重领、leaseToken fencing、旧 dispatcher 迟到回写。
3. 审核浏览器请求超时/非 JSON 响应/部分成功/重复接受时的语义；不能把“服务端接受”误报为邮件最终送达。
4. 审核 API route 的 Origin、Cloudflare Access JWT、body 大小、事件数、字段校验、HTTPS Worker URL、HMAC 签名和错误返回。
5. 补充测试：伪造字段、超大请求体、重复事件、错误 Origin、缺失/无效身份、HMAC 时间戳/签名边界、部分结果及 lease 过期竞态。
6. 不输出密钥、不在代码或测试中放真实 Key/Secret；测试只使用明显虚构的 dummy secret。
7. 更新本文件，列出修改文件、测试结果、commit SHA、CI URL 和尚未覆盖的风险。

### B. SELL 卖出链路安全审查与模拟测试（Grok 主责）
**允许修改文件：**
- `lib/execution/sell-guard.ts`
- `lib/execution/sell-guard.test.ts`
- `lib/execution/sell-signal-queue.ts`
- `lib/execution/sell-signal-queue.test.ts`
- `lib/execution/sell-store.browser.ts`
- `lib/execution/sell-store.browser.test.ts`
- `lib/execution/sell-order.browser.ts`
- `lib/execution/sell-order.browser.test.ts`
- `lib/execution/sell-order-submit.browser.ts`
- `lib/execution/sell-order-submit.browser.test.ts`
- `lib/execution/sync-sell-order.browser.ts`
- 可新增 SELL 专属测试/文档。

**目标：**
1. 审核 SELL 事件从 signal reservation → dry-run/preflight → submit guard → exchange reconcile → confirmed fill 的状态转换。
2. 覆盖重复事件、过期/陈旧行情、部分成交后取消、终态快照落后、重复成交、成交量/订单量不匹配、底仓保护、数量步长/最小名义金额等。
3. 核实任何异常/不确定结果都进入 reconcile/manual review，不得盲目重发 SELL。
4. 明确只有已确认交易所成交才可记为 executed；pending/blocked 不得当成已卖出。
5. 保持 SELL 实盘开关关闭；只允许 mock/dry-run/纯逻辑测试，不得发送真实卖单、不得改真实 API 权限。
6. 不得修改共享的 `store.browser.ts`、`types.ts`、`position-accounting.ts`、`position-accounting.browser.ts`、`components/Dashboard.tsx`、策略配置或 BUY 资金预留代码。
7. 若发现 SELL 需要跨越上述共享文件才能安全修复，先在本文件提出具体冲突点，不要直接改。

### C. 与 GPT 的文件隔离
- Grok 本轮负责以上通知模块和 SELL 专属模块。
- GPT 继续负责 BUY 资金预留、买入订单状态、IndexedDB 恢复/并发测试。
- 双方不得修改对方白名单文件；尤其 Grok 不修改 BUY store/queue 和 Dashboard。
- 通知事件由 BUY/SELL 已确认成交产生，Grok 只能消费/验证事件，不改变成交台账的真源与原子写入流程。
- 如果 GitHub Actions 中出现另一方提交导致的回归，先定位责任文件再修，不要直接回滚另一方提交。

### 验收标准
- 至少新增覆盖关键边界的自动化测试；完整 test + typecheck 必须通过。
- 仅 CI 通过不代表真实交易或邮件投递成功。
- 每完成一条任务线，更新本文件和 GPT 工作记录中的状态/commit/CI。
