# Grok工作记录

> 主开发分支：gpt。策略依据《策略3.3》。遵守文件白名单与项目规则。

## 冲突检查
未改 GPT 的 BUY 预留、strategy.config、Dashboard。本轮新增卖出节拍与文档。

## 本轮完成（面向自动化交易）

### 1. 卖出自动化单次节拍
- 文件：`lib/execution/sell-automation-tick.ts`
- 流程：信号入队 → 对账同步 →（双开关+数据新鲜才尝试）最多一笔 pending 卖出 → 通知 Outbox
- 默认不实盘：`attemptLiveSubmit` 与 `BINANCE_SPOT_SELL_SUBMISSION_ENABLED` 同时为真才提交
- 提交：`6d11f86900f1e13043a04ec5698848ddc14f7a00`

### 2. 自动化落地路径文档
- `docs/策略3.3/自动化交易落地路径.md`
- 明确：框架有 ≠ Testnet 验收有 ≠ 可生产无人值守

### 3. 此前已完成（仍有效）
- 底仓减仓后受保护底仓重算、止盈部分成交 resume（`sell-signal-queue.ts`）

## 自动化系统真实状态（给用户）
- **半自动**：打开看板 + 测试网开关 → 可沿现有 Background 跑
- **全自动无人值守**：还缺 Testnet 全链路实测 + 服务端常驻调度 + 生产授权
- **下一步建议**：Testnet 小额买一笔、卖一笔（止盈），记工作记录；再谈 VPS/Worker 调度

## 验证
```bash
npx vitest run lib/execution/sell-signal-queue.resume.test.ts lib/execution/sell-guard.test.ts
```
（节拍模块依赖浏览器 store，单测可后续补 mock）

## 安全
生产 BUY/SELL 保持关闭；不提交真实密钥。


## 后续排队任务三：成交通知 Outbox 租约与重复投递审计（前两项SELL返工通过后开始）

> 本任务与当前SELL队列返工分开，先排队，不得因此延迟任务一、二的修复和CI。

- 审查范围：`lib/execution/notification-outbox.ts`、`lib/execution/notification-dispatch.browser.ts`、`lib/execution/store.browser.ts` 中 Outbox 的领取/完成/失败写入路径，以及对应测试和服务端通知API契约。不要修改BUY资金预留或共享成交账本。
- 已发现待核查点：`isTradeNotificationClaimable` 当前把 `status="sending"` 且 `leaseUntil=null` 的记录按0处理，导致异常/损坏的无租约sending记录可能立即被再次领取。请确认应 fail-closed 并要求人工/恢复流程，而不是自动重发。
- 审查租约过期并被新标签页接管后，旧调度器是否可能将服务端已接受的通知标为failed，造成重复发送；确认leaseToken fencing在所有成功/失败写入路径均生效。
- 审查批量API部分接受、HTTP超时但服务端已入队、重复事件ID、服务端duplicate回执、浏览器崩溃重启、失败退避、租约超时和多标签页并发。必须明确通知投递语义是至少一次还是可实现幂等效果，不得宣称网络层严格 exactly-once。
- 至少增加测试：sending缺失租约/无效租约不自动领取；租约到期后新token接管，旧token不能回写；服务端接受后浏览器超时重试时，事件ID去重；部分批次结果不明确时仅安全重试未确认事件或依赖服务端幂等；多标签页同时领取不得重复有效租约。
- 只在任务一、二全部测试及CI通过后开始本任务；先提交审计证据，再提交最小修复和测试。不得改变通知内容、接收人或邮件频率规则；中文提交说明；mock/dry-run，不触发真实交易。
- 完成后交GPT独立验收，提供文件、测试、CI、提交SHA和剩余风险。
