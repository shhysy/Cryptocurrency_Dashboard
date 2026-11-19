# Grok 工作记录

> 维护者：Grok。说明用中文。分支：仅 `gpt`。遵守 `项目规则.md`。

## 冲突检查
已读 Phase 33/34。策略权威为仓库内 `长期投资策略V3.2_优化版_V3.3.xlsx`（策略 3.3）。本轮主要文档与任务指派，不改 GPT BUY/store 文件。

---

## 关于策略 Excel 是否已读

- **仓库内文件名**：`长期投资策略V3.2_优化版_V3.3.xlsx`（根目录）。
- **GPT 侧**：已在 Phase 34 用 Python 读取用户确认的同系列工作簿（11 个工作表），并写入 `STRATEGY.md` / `docs/RULES_IMPLEMENTATION_MATRIX.md`。
- **Grok 侧**：以该文件与项目规则 §0 为约束；SELL/通知实现不擅自改策略参数。若需逐格复核数值，与 GPT 矩阵对照，**不直接改 `strategy.config.ts`**（属共享/策略边界，需用户授权）。

---

## 项目规则更新

- 已在 `项目规则.md` 增加 **§0：策略必须按照长期投资策略V3.2_优化版_V3.3.xlsx**。

---

## 给 GPT 的任务指派（尽量避免与 Grok 冲突）

> GPT 同步写入 `gpt工作记录.md`。说明与注释用中文。策略以 Excel 3.3 为准，**禁止擅自改阈值**。实盘开关保持关闭。

### A. 策略 3.3 → 实现对照矩阵（文档为主，不改参数）
- 对照 `长期投资策略V3.2_优化版_V3.3.xlsx` 与 `strategy.config.ts` / 引擎 / 执行层。
- 更新 `docs/RULES_IMPLEMENTATION_MATRIX.md`：每项标记 **已实现 / 部分实现 / 未实现 / 与 Excel 不一致（待用户确认）**。
- **不得**为「对齐」直接改阈值；不一致只记录。

### B. 数据完整性与执行许可（分析 + 可选 fail-closed 方案，先文档）
- 未收盘周线、ticker 替换 close、恐惧贪婪缺失、多源 asOf 不一致时，当前是否仍可能产生买入/卖出**执行许可**。
- 输出建议状态机：`fresh` / `stale_display_only` / `incomplete_block_execution` 等。
- 若改代码：仅限 GPT 白名单（如 `lib/service.ts`、信号装配层），并先在记录中写清与 Excel 条款的对应关系；**改前需用户确认策略意图**。

### C. BUY 侧 IndexedDB / 预留（延续）
- 真实浏览器多标签、重启恢复、quota 等（fake-indexeddb 不能冒充跨进程）。
- 文件范围：`store.browser.ts`、`fund-reservation.ts` 及其测试。

### D. 测试网验收清单（文档）
- 写一份「币安测试网：信号→预检→极小额买→对账→通知」步骤清单与检查表。
- **不**在文档中要求打开生产 LIVE；不提交任何真实密钥。

### 明确不分配给 GPT（避免冲突）
- `sell-guard.ts`、notification-outbox/dispatch、预备订单模块 → **Grok**
- 不得把预备订单接入自动下单
- 不得修改策略 Excel 原文件

---

## Grok 本侧近期状态（摘要）

- SELL guard 未授权底仓减仓已修复；通知边界测试与 SELL 状态机文档已交。
- 后续 Grok 继续通知/SELL 模拟，不碰 GPT 资金预留核心。
