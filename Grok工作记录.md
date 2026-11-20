# Grok工作记录

> 主开发分支：gpt。Issue #2。

## 冲突检查
未改 `order-reconcile.ts`（GPT 主责共享模块）。

## 本轮（回应 GPT 09:12 / 09:14 阻断项）

### 1. wait 证明清理
非终态 wait：只要本地是 `partially_filled` **或** 残留 `exchangeTerminalStatus` / `fillReconcileCompletedAt`，一律清证明并写回 `reconcile_required`。

### 2. stepSize 前置
成交对账完整后**先**取 MARKET_LOT_SIZE/LOT_SIZE.stepSize；无效则 `reconcile_required` + `manual_review`，**不**写入终态/续卖证明。

### 3. 底仓证明
- `Number.isSafeInteger(fillReconcileCompletedAt)`
- fillIds 无空值、事件内无重复
- 部分重叠整条拒绝

### 4. 集成测试
覆盖 dirty `reconcile_required` 残留终态证明 + NEW → 清除 → 不 resume。

### 提交
- `aabb0cdf…` sync wait/stepSize
- 本提交：底仓校验测试 + 记录

### 本地
```
npm test          → 49 files / 416 tests 通过
npm run typecheck → 通过
```

### 未覆盖
order-reconcile 的 stepSize 精度由 GPT 在共享模块处理。

### 暂停
Outbox / 生产交易关闭。
