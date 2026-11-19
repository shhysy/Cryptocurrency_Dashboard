# Grok 工作记录

> 维护者：Grok。说明用中文。分支：仅 `gpt`。遵守 `项目规则.md`。

## 冲突检查（本轮）
已读 `gpt工作记录.md` Phase 32/33。CI 唯一失败为 SELL guard；由本侧修复。未改 GPT BUY/store 文件。

## 本轮完成（Phase 33）

### P0 修复 SELL guard
- `base_reduce` 必须 `allowBaseReduction === true`，否则拒绝（修复未授权误走周期仓）。
- 文件：`sell-guard.ts`、`sell-guard.test.ts`
- 提交：`fa8808a42441b46bad2849db2a0c2ceafe224954`、`a3840beff2fa10ccaaa2fdb620f2a5a7652d382f`

### P0 通知边界
- 签名时间戳边界测试；成交构造缺 ID/负手续费拒绝（见 notification 测试）。
- HMAC 仍只读服务端环境变量。

### P1 SELL 状态机
- 文档：`docs/SELL_STATE_MACHINE_REVIEW.md`
- 未开启实盘卖出。

### 验证命令
```bash
npx vitest run lib/execution/sell-guard.test.ts lib/execution/notification-outbox.test.ts lib/execution/notification-signature.server.test.ts
```



## 2026-11-19 项目规则版本确认（GPT同步）
- 用户确认项目长期使用上传的 `长期投资策略V3.2_优化版_V3.3(1).xlsx`，统一版本名称为 **策略 3.3**。
- 后续 SELL / 通知实现必须遵循该 Excel 原始规则；不得自行更改止盈、底仓减仓、追踪止损、基本面退出或风险参数。
- 当前 Excel 页签部分标题仍保留 V3.2，但参数中心记录 V3.3 变更。以用户指定的策略 3.3 作为项目规则名，保留原表数值；如发现代码与 Excel 不一致，先记录差异并提交 GPT 评审，不在 Grok 白名单中改策略配置/引擎。
- GPT 已在 `STRATEGY.md` 和 `docs/RULES_IMPLEMENTATION_MATRIX.md` 固定规则来源；Grok 工作记录同步此治理约定。
