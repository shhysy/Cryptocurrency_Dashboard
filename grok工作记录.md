# Grok 工作记录

> 本文件由 Grok 维护，记录已实现 / 未实现事项。  
> **每次开工前**：先读 `gpt工作记录.md`（若存在），检查是否与当前工作冲突；有冲突先对齐再改代码。  
> **检查时间**：2026-11-19 — 当时仓库尚无 `gpt工作记录.md`，无冲突。

---

## 〇、分支约定（重要）

| 项 | 约定 |
|----|------|
| **唯一开发分支** | **`gpt`** |
| **`grok` 分支** | **不再使用**；Grok 后续提交、功能、工作记录更新 **只推 `gpt`** |
| 历史说明 | 早期看板/UI 曾在 `grok` 分支；自预备订单起主线已在 `gpt`，用户确认废弃 `grok` 分支作为开发线 |

---

## 一、与 GPT 侧协作约定

| 项 | 说明 |
|----|------|
| 本文件 | `grok工作记录.md`（在 **gpt** 分支维护） |
| 对方文件 | `gpt工作记录.md`（对方维护；不存在则视为暂无对方纪要） |
| 冲突处理 | 同一文件/同一开关/同一策略语义若两边都改，先对比再合并，避免互覆盖 |
| 代码提交 | **仅 `gpt` 分支** |

---

## 二、刚刚完成（2026-11-19）— 预备订单 CSV

**需求**：第一笔买入后，把后续买入 + 止盈写成「预备订单」CSV；止盈后清掉头仓锚定补仓，改按均价回补；回补后重算止盈触发价。

### 已实现

| 项 | 位置 | 说明 |
|----|------|------|
| 初始预备计划 | `lib/execution/prep-orders.ts` → `buildInitialPrepPlan` | 头仓后：补仓 1–4、备用金、止盈档（触发价/金额或周期仓比例） |
| 止盈后重建 | `rebuildPrepPlanAfterTakeProfit` | 原补仓/备用金 → `cancelled`；按**当前均价**生成回补 1–N；止盈按新均价重算 |
| 回补后刷新 | `refreshTakeProfitsAfterReplenish` | 均价变化后刷新 pending 止盈与回补触发价 |
| CSV 导出 | `lib/execution/prep-orders-csv.ts` | UTF-8 BOM，可下载 |
| 本地持久化 | `lib/execution/prep-store.browser.ts` | `localStorage` 键 `prep-order-plans-v1` |
| UI | `components/PrepOrdersPanel.tsx` | 生成 / 导出 / 「记止盈1/2/3」；有持仓可自动生成初始计划 |
| 挂载 | `components/Dashboard.tsx` | 待买队列 Tab + 主布局 |

**提交**：全部在 **`gpt` 分支**。

### 未实现（本需求相关）

| 项 | 说明 |
|----|------|
| 自动侦测交易所已止盈 | 需用户点「记止盈」或后续接 `sell-signal-queue` |
| 预备订单自动下单 | 仅计划 + CSV；`LIVE_*` 仍关闭 |
| CSV 作为执行唯一真源 | 真源是 localStorage；CSV 为导出备份 |
| 与 `post-take-profit-rebuy` 深度合并 | 并行计划层，需避免双轨语义 |

---

## 三、历史已实现（摘要）

- 看板信号、100 分制、通知/Toast、CL 合约行情等（早期部分在 grok，主线已转到 gpt）
- 执行层代码存在但默认 **不实盘**；换 Key ≠ 自动交易
- 止盈在策略引擎为 **信号**，非自动卖出

---

## 四、明确未实现

1. 全自动实盘买卖  
2. 止盈后均价回补写入主 engine 的完整统一（与 GPT 模块对照）  
3. WebSocket 触价 / 高频轮询  
4. 预备订单 → 自动入队下单闭环  

---

## 五、下次开工检查清单

- [ ] 只在 **`gpt` 分支** 拉代码与提交  
- [ ] 读取 `gpt工作记录.md`（若有）查冲突  
- [ ] 不向 **`grok` 分支** 再推功能  
- [ ] 不打开 `LIVE_*` 除非用户明确要求  

---

## 六、变更日志

| 日期 | 摘要 |
|------|------|
| 2026-11-19 | 创建本文件；预备订单已实现/未实现；确认无 gpt工作记录.md |
| 2026-11-19 | **约定：仅使用 gpt 分支，停止使用 grok 分支作为开发线** |


## 七、GPT / Grok 并行分工（2026-11-19）

### 本轮 Grok 负责：预备订单人工计划完善
**允许修改：**
- `lib/execution/prep-orders.ts`
- `lib/execution/prep-orders-csv.ts`
- `lib/execution/prep-store.browser.ts`
- `components/PrepOrdersPanel.tsx`
- 与上述文件直接对应的独立测试、预备订单说明文档。

**目标：**
1. 完善人工计划生成、止盈后重建、回补后触发价刷新。
2. 加强计划状态/CSV 一致性、输入校验和异常处理。
3. 补充预备订单核心单元测试；CSV 仅为导出快照，不是执行真源。
4. UI 明确显示“人工计划”，不得伪装为交易所已挂单或自动执行状态。
5. 记录修改文件、测试结果、commit SHA、CI。

**禁止修改：**
- `components/Dashboard.tsx`
- `lib/execution/fund-reservation.ts`
- `lib/execution/store.browser.ts`
- `lib/execution/buy-order-submit.browser.ts`
- `lib/execution/sync-buy-order.browser.ts`
- 成交台账、资金预留及自动执行开关。

### GPT 当前负责：资金预留与订单恢复安全
GPT 负责资金预留事务、并发预留/认领、部分成交扣减、终态释放、旧 attempt 隔离、IndexedDB 恢复与异常 fail-closed。GPT 不修改本记录中 Grok 负责的预备订单核心文件，也不修改 `Dashboard.tsx`。

### 共同约束
- 唯一开发分支为 `gpt`。
- 不将 localStorage/CSV 预备订单计划接入自动下单。
- 两条线不得同时修改同一核心文件；跨边界需求先协商并更新双方记录。
- LIVE BUY/SELL 与 Simple Earn 自动赎回保持关闭；不使用真实余额、不发送真实订单。
- 双方每次开工先读取两份工作记录，结束时更新自己的记录，写明测试、commit SHA、CI。

### 分工日志
- 2026-11-19：接受并记录本轮分工。Grok 专注预备订单人工计划/CSV；GPT 专注资金预留与执行订单恢复安全。
