# Grok 工作记录

> 本文件由 Grok 维护，记录已实现 / 未实现事项。  
> **每次开工前**：先读 `gpt工作记录.md`（若存在），检查是否与当前工作冲突；有冲突先对齐再改代码。  
> **检查时间**：2026-11-19 — 仓库 `gpt` / `grok` 分支上 **尚无** `gpt工作记录.md`，本次无冲突可记。

---

## 一、与 GPT 侧协作约定

| 项 | 说明 |
|----|------|
| 本文件 | `grok工作记录.md` |
| 对方文件 | `gpt工作记录.md`（对方维护；不存在则视为暂无对方纪要） |
| 冲突处理 | 同一文件/同一开关/同一策略语义若两边都改，先对比再合并，避免互覆盖 |
| 分支 | Grok 近期功能多落在 `gpt` 分支（预备订单）与历史 `grok` 分支（看板 UI/通知等） |

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

**提交**：已推到 **`gpt` 分支**（含 `prep-orders*`、`PrepOrdersPanel`、`Dashboard` 挂载）。

### 未实现（本需求相关）

| 项 | 说明 |
|----|------|
| 自动侦测交易所已止盈 | 需用户点「记止盈」或后续接 `sell-signal-queue`，不会因币安成交自动切「均价回补」模式 |
| 预备订单自动下单 | **仅计划 + CSV**，不提交币安订单；`LIVE_*` 仍关闭 |
| 用 CSV 作为执行唯一真源 | 真源是 localStorage；CSV 为导出备份 |
| 与 GPT 已有 `post-take-profit-rebuy` 深度合并 | Dashboard 仍调用 `strategy/post-take-profit-rebuy`；预备订单是并行计划层，语义需避免长期双轨打架 |

---

## 三、历史已实现（Grok 相关，摘要）

### 看板 / 策略展示

- 机会指数、核心/山寨门槛、排序、Hero/紧凑卡片、ScoreBar、主题等（多在 `grok` 分支演进）
- 满分映射 **100 分制**（`scoreMax: 100`，分项按 /90 映射）— 以当前分支 `strategy.config.ts` 为准
- CL 改币安合约行情（信号 only）等稳定性向改动

### 通知

- 分数达标邮件（`scripts/notify-score.mjs`、`/api/notify`、`lib/mail-notify.ts`）
- 页面加载/定时触发检测 + 冷却；右侧 ScoreToast
- QQ SMTP；门槛分环境变量（核心/山寨）

### 执行层（以 `gpt` 文档为准，Grok 未打开实盘）

- 待买/待卖队列、预检、对账、BUY/SELL 编排代码存在
- **`LIVE_*` / DRY_RUN 默认不发真实订单**
- 换真实 Key **不等于**自动交易已可用

### 止盈信号（策略引擎）

- `planSell`：均价倍数止盈、指标止盈、追踪、底仓减仓 → **信号层**
- 配置中核心/山寨 `takeProfit` 比例（如 0.5 / 0.3 / 0.8）以仓库当前文件为准
- **不是**自动卖出

---

## 四、明确未实现 / 不要默认当成已有

1. **全自动实盘买卖**（开开关 + 联调 + 调度之前都未完成）  
2. **止盈后仅按均价回补** 的完整引擎主路径（话术已定；预备订单计划层已做；主 `engine` 是否已完全改为该语义需与 GPT 的 `post-take-profit-rebuy` 对照）  
3. **毫秒级行情轮询**（当前 ticker 缓存约 1 分钟、页面约 60s 刷新）  
4. **WebSocket 第一时间触价**（未做）  
5. **预备订单 → 自动入队下单** 闭环（未做）  

---

## 五、下次开工检查清单

- [ ] 读取 `gpt工作记录.md`（若有）是否改了同一执行/策略文件  
- [ ] 确认分支：`gpt` vs `grok` 哪条是主开发线  
- [ ] 预备订单若与 `post-take-profit-rebuy` 冲突，先统一「止盈后回补」真源  
- [ ] 不打开 `LIVE_*` 除非用户明确要求并知风险  

---

## 六、变更日志

| 日期 | 摘要 |
|------|------|
| 2026-11-19 | 创建本文件；记录预备订单 CSV/UI 已实现与未实现；确认当时无 `gpt工作记录.md` |
