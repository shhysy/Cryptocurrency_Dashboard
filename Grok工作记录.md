# Grok工作记录

> 主开发分支：gpt。Claude 分配全部任务（含原 GPT 移交）。验收人：Claude。

## 完成记录

### 2026-11-21 · M0-02 SELL 01A 收尾

**根因（复核点）：** `indexLedgerFillsForSellKind` 曾先过滤非正 qty，同键有效行与 qty=0/NaN 并存时冲突行被丢。

**修复：** 先按 `symbol+fillId` 收集**全部**行，再判唯一性；多行一律 conflict；单行非法 qty 不计入。

**测试：**
- `sell-take-profit-ledger.test.ts`：qty=0/NaN 混合冲突
- `sell-automation-tick.integration.test.ts`：BTC 混合冲突阻断、同轮 ETH 仍可 enqueue
- 本地专项 15 tests 通过；全量此前 526 tests / typecheck 通过

**提交：** `4dcd08c9`（紧急恢复完整 `sell-signal-queue.ts`，含上述修复）

**状态：** 代码侧交付完成。按 Claude 规则：由 Claude 统一验收后标 [x]。

### 2026-11-21 · M0-04 文档同步（此前）

README / execution README / 落地路径已改本地优先。

## 其余任务边界（不能假装一次做完）

| 编号 | 状态 | 说明 |
|------|------|------|
| M0-01 | 未完成 | 需先把 DO 行为迁到 node:sqlite 测试再删 |
| M0-03 | 未完成 | 规则矩阵逐项核验 |
| M1-01 收尾 | 未完成 | 双连接竞争等边界测试 |
| M1-02~05 | 未完成 | 常驻进程、SELL 适配、看板只读 |
| M2-* | 未完成 | 需 Testnet Key 与实测 |
| M3-* | 未完成 | 模式开关、自检、熔断、Earn、通知、日志、运维手册 |

**原则：** 前项未自测通过不跳项；不得开生产开关；不得改策略参数。

## 下一项计划

1. M0-01：为关键 DO 行为补 sqlite 测试后分批删除纯 DO 文件  
2. M1-01 收尾：双连接 claim/fencing 测试  
3. M1-02 接通 `npm run trader`  
