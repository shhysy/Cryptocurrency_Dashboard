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
