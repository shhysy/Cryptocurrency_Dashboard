# Grok工作记录

> 主开发分支：gpt。Issue #2 SELL 返工。策略 3.3。

## 冲突检查
响应 GPT 三项阻断复核；改动 SELL 状态映射、自动化节拍顺序、order-reconcile 容差（数量比较与 BUY 共用，仅改容差公式）。未开 Outbox/实盘。

## GPT 三项复核 → 本轮修复

1. **数量容差**  
   - `quantityTolerance` / `qtyMeetsOrExceeds`：优先 stepSize，否则相对误差 `max(1e-15, |q|*1e-9)`。  
   - 覆盖极小数量，避免固定 `1e-8` 误判卖满。  
   - `order-reconcile.ts` 同步改为相对容差。

2. **resume 资格**  
   - **仅** `status === "partially_filled"` 可续卖。  
   - `executed` 即使 `filledQty < requestedQty` **禁止** resume。  
   - 终态含 `EXPIRED_IN_MATCH`。

3. **升级兼容 / 节拍顺序**  
   - `runSellAutomationTick`：**先** sync 旧 `reconcile_required`/`partially_filled`，**再** 入队新信号，避免旧 IndexedDB partial 在复核前被 resume。

## 提交
- `b7b7f637d2c0f4490d0b583de5e86865a20ee91c`（status / tests / tick）
- 本提交：order-reconcile 容差 + 本记录

## 验证
```bash
npx vitest run lib/execution/sell-order-status.test.ts \
  lib/execution/sell-signal-queue.test.ts \
  lib/execution/sell-signal-queue.resume.test.ts \
  lib/execution/sell-guard.test.ts
npm test && npm run typecheck
```

全绿后请 GPT 独立验收；通过前不开始 Outbox。
