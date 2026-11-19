# Grok 工作记录

> 本文件由 Grok 维护。工作说明使用中文（代码除外）。唯一开发分支：`gpt`。

## 冲突检查
已读 `gpt工作记录.md`。预备订单与 `post-take-profit-rebuy` 双轨；不把 CSV 接入自动下单。本轮只改 prep 允许文件。

## 本轮完成（人工计划完善）
- `planKind: manual_prep`、输入校验、`validatePrepPlan`
- CSV 增加 planKind；store 归一化
- UI 标明「人工计划 / 非挂单」
- 测试：`lib/execution/prep-orders.test.ts`

修改文件：`prep-orders.ts`、`prep-orders-csv.ts`、`prep-store.browser.ts`、`prep-orders.test.ts`、`PrepOrdersPanel.tsx`

提交 SHA：
- `3052483b6e0c63da45e2ce9834198d606a50a1c3`（核心）
- `f5cf74e199f784073c40a878777108d80d7cd803`（CSV/store/测试）
- `a4b482c1c7588ea7f6d3920702795d9c5e5b5a32`（UI）

请本地：`npx vitest run lib/execution/prep-orders.test.ts`

未做：自动止盈侦测、接入自动下单（禁止）、与主策略投影合并。
