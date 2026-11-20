# Grok工作记录

> 主开发分支：gpt。项目规则唯一依据《策略3.3》。严格遵守文件白名单；跨边界先记录，不直接修改共享文件。

## 安全约束
- 生产现货BUY/SELL关闭；Simple Earn自动赎回关闭。
- SELL/通知测试使用mock或dry-run，不发送真实订单、不使用真实资金。
- HMAC secret仅从服务端环境变量读取，不写日志、响应或仓库。
- 未知提交结果不得盲目重试，必须进入对账/人工复核。

## 历史任务状态（需重新验证）
- SELL guard底仓减仓显式授权问题：历史记录称已修复，相关commit为fa8808a42441b46bad2849db2a0c2ceafe224954及a3840beff2fa10ccaaa2fdb620f2a5a7652d382f；必须以当前HEAD和最新CI确认。
- 通知Outbox/HMAC已有部分签名时间戳与成交字段校验；完整安全边界测试仍需核验。
- SELL状态机审查文档：docs/SELL_STATE_MACHINE_REVIEW.md，需逐状态复核。

## 策略3.3强制规则
唯一规则源为用户确认的策略3.3 Excel。必须核对积极/保守型不同止盈倍数与比例、追踪止损、底仓比例、基本面失效项数。SELL数量必须依据真实持仓、真实成交与底仓保护；计划单、CSV或未确认事件不得构造成交。

## Grok负责范围
- sell-guard.ts及专属测试。
- sell-signal-queue.ts、sell-store.browser.ts及专属测试。
- sell-preflight.browser.ts及专属测试。
- sell-order.browser.ts、sell-order-submit.browser.ts、sync-sell-order.browser.ts及专属测试。
- notification-outbox.ts、notification-dispatch.browser.ts、notification-signature.server.ts、app/api/trade-fill-notifications/route.ts及专属测试。
- SELL/通知状态机文档。

## 禁止修改
GPT的BUY资金预留、fund-reservation.ts、store.browser.ts、buy-order-submit.browser.ts、sync-buy-order.browser.ts、strategy.config.ts、strategy/engine.ts、position-accounting.ts和Dashboard。若需要共享模型修改，先写明Excel依据、影响和建议，等待协调。

## 每次提交记录
文件列表、对应策略3.3工作表/规则、commit SHA、测试结果、CI链接、未覆盖风险。

## 用户A–G决策确认（2026-11-19）
用户选择A2/B2/C2/D2/E2/F2/G2，具体值以docs/策略3.3/策略3.3用户确认决策.md为准。SELL实现需采用B2止盈差异：积极型倍数2/3/5、保守型1.3/1.6/2；三档比例50/30/80均按本轮初始周期仓计算，每档实际数量不得超过剩余周期仓。A2下BTC/PAXG核心、ETH保守型。H未选择，不擅自调整H项。G2仅决定展示软失败并标记stale，不允许把陈旧数据当新鲜数据。

## 规则更新记录（2026-11-19）
- 已更新根目录《项目规则.md》：所有Git commit标题和正文必须使用中文，禁止纯英文提交说明；Push结果汇报、分支说明、PR标题与正文、审查意见及项目工作记录均使用中文。必要技术名词、文件名、分支名和代码标识符可保留英文。
- 本次仅修改项目规则与工作记录，未修改业务代码；未运行测试（文档变更）。


## GPT策略层修复同步（2026-11-20）
- GPT已按用户确认的初始周期仓止盈口径更新策略层：保守型止盈倍数1.3/1.6/2，三档比例按本轮初始周期仓计算并受剩余周期仓限制。
- 同步修复未收盘周线指标污染、追踪止损峰值使用周线最高价、刷新失败/快照过期时撤销新订单许可。
- 本轮未修改Grok主责的 `sell-guard.ts`、`sell-signal-queue.ts`、`sell-store.browser.ts`、SELL订单提交/同步及通知Outbox文件；后续如需调整这些文件，仍需先对照矩阵和工作记录协调。
- 请Grok后续核查：部分成交终态后同一止盈档剩余目标的恢复策略，以及底仓减仓确认成交后周期仓可卖数量的重算；不得直接覆盖GPT策略层变更。
- 当前策略层与回归测试在CI Run `44695496846` 通过；生产BUY/SELL与Simple Earn真实赎回仍关闭。
