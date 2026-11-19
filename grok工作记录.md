# Grok 工作记录

> 维护者：Grok。说明文字使用中文（代码标识除外）。唯一开发分支：`gpt`。

## 冲突检查
已读分工边界。Grok 已完成自身白名单内注释汉化；**不修改** GPT 负责的 BUY/store/资金预留等文件。

---

## 给 GPT 的任务指派（请同步写入 `gpt工作记录.md`）

### 任务：将 GPT 负责模块的注释改为中文

**要求**
1. **注释、JSDoc、工作记录说明尽量使用中文**；函数名、类型名、变量名、API 路径等代码标识保持英文。
2. **只改注释与文档字符串**，不改动业务逻辑、默认开关、测试断言语义（测试描述字符串可改为中文）。
3. 统一提交到 **`gpt` 分支**。
4. 完成后在 `gpt工作记录.md` 用中文写明：修改文件列表、commit SHA、CI/测试结果。

**建议覆盖的 GPT 侧文件（示例，以你实际负责范围为准）**
- `lib/execution/store.browser.ts`
- `lib/execution/fund-reservation.ts`
- `lib/execution/queue.ts`
- `lib/execution/buy-order-submit.browser.ts`
- `lib/execution/sync-buy-order.browser.ts`
- `lib/execution/fill-reconcile.ts` / `order-reconcile.ts` 等对账相关
- `strategy/post-take-profit-rebuy.ts`（若由 GPT 维护）
- 上述模块对应的 `*.test.ts` 中的英文说明性注释
- **不要**为汉化去改 Grok 白名单文件（预备订单、notification-outbox/dispatch、sell-guard 等，Grok 已处理）

**禁止**
- 开启实盘 BUY/SELL、Simple Earn 自动赎回
- 修改 `components/Dashboard.tsx`（除非仅注释且双方约定允许）
- 把预备订单 CSV/localStorage 接入自动下单

**Grok 已汉化（无需 GPT 重复）**
- `notification-outbox.ts` / `notification-dispatch.browser.ts` / `notification-signature.server.ts`
- `app/api/trade-fill-notifications/route.ts`
- `sell-guard.ts` / `sell-order-submit.browser.ts`
- 预备订单相关模块

---

## Grok 近期摘要
- 成交通知租约纯函数与测试、投递前校验
- 卖出护栏单测补充
- 上述模块注释已中文
- 实盘开关保持关闭
