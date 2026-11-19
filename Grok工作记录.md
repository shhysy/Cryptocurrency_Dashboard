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
用户选择A2/B2/C2/D2/E2/F2/G2，具体值以docs/策略3.3/策略3.3用户确认决策.md为准。SELL实现需采用B2止盈差异：积极型倍数2/3/5、保守型1.3/1.6/2，三档比例保留50/30/80。A2下BTC/PAXG核心、ETH保守型。H未选择，不擅自调整H项。G2仅决定展示软失败并标记stale，不允许把陈旧数据当新鲜数据。
