# Grok工作记录

> 主开发分支：gpt。用户要求：先实现功能，再交 GPT 验收。

## 本轮（GROK-SELL-06 Outbox 实现）

### 实现
- `isTradeFillNotificationDispatchEnabled`：**默认关闭**（`NEXT_PUBLIC_TRADE_FILL_DISPATCH_ENABLED=1` 才投递）
- 已有 lease/token fencing 保留；补齐边界测试
- IndexedDB：claim 互斥、过期接管、旧 token 拒绝 sent/failed
- dispatch：不完整 accepted 整批失败路径

### 本地
```
npm test → 64 files / 509 tests 通过
npm run typecheck → 通过
```

### 安全边界（未改）
- 生产 BUY/SELL **关闭**
- Outbox 生产投递 **默认关闭**
- 不宣称 exactly-once，至少一次 + 服务端幂等

### 请 GPT 验收
1. SELL-01～05 / 01A 台账与 resume
2. SELL-06 Outbox 租约/fencing/默认关闭
3. 全量测试与 CI

未改 GPT 共享模块。
