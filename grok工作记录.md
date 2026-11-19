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


## 2026-11-19 新增任务分配：失败修复 + 通知/SELL 验收（GPT 指派）

### 任务 1（P0）：修复 SELL guard 当前 CI 失败
- 已复核失败用例：`lib/execution/sell-guard.test.ts` 中「底仓减仓未显式允许时拒绝」期望拒绝，但当前实现仍允许。
- 当前 `sell-guard.ts` 仅在 `allowBaseReduction` 为 true 时切换到底仓数量；当该字段缺失时仍默认按周期仓数量计算并允许卖出，这是缺少显式授权的 fail-closed 检查。
- 必须在任何数量计算前明确拒绝 `kind === "base_reduce" && allowBaseReduction !== true`；授权后才允许按剩余底仓 50% 规则计算。增加字段为 false、undefined、true 的测试，以及无效数量/负数/NaN/Infinity 的边界测试。
- 只修改 Grok 白名单中的 `sell-guard.ts` 与 `sell-guard.test.ts`。

### 任务 2（P0）：通知 Outbox / HMAC API 完整安全测试
- 文件范围：`notification-outbox.ts`、`notification-dispatch.browser.ts`、`notification-signature.server.ts`、`app/api/trade-fill-notifications/route.ts` 及各自专属测试。
- 覆盖签名错误、时间戳过期、未来时间、重放、body篡改、缺少/异常字段、超大请求体、重复事件幂等、租约过期后旧 worker 不能确认/覆盖新租约、退避上限、网络超时/5xx/4xx 分类。
- 验证通知只消费已确认成交，不允许从待提交订单或计划状态构造“已成交”通知。
- HMAC secret 只从服务端环境变量读取；不得写入日志、响应或仓库示例真实值。

### 任务 3（P1）：SELL 全链路状态机审查
- 文件范围：`sell-signal-queue.ts`、`sell-store.browser.ts`、`sell-preflight.browser.ts`、`sell-order.browser.ts`、`sell-order-submit.browser.ts`、`sync-sell-order.browser.ts` 与 SELL 专属测试。
- 覆盖 pending → claimed → submitted/unknown → reconcile_required → partial fill → terminal；确保超时/网络失败不盲目重复提交，未知状态保留人工对账，部分成交只按实际成交数量记账，终态后才释放相关锁定。
- 检查 clientOrderId 幂等、attempt fencing、重复 fill 冲突、交易对/精度/最小金额/可卖余额校验。
- 所有验证使用 mock/dry-run；不得发送真实 SELL。

### 严格文件边界
- 不修改 GPT 的 BUY 资金预留、`store.browser.ts`、`fund-reservation.ts`、`buy-order-submit.browser.ts`、`sync-buy-order.browser.ts`、`position-accounting.ts`、`strategy.config.ts`、`strategy/engine.ts`、Dashboard。
- 不改共享数据模型；若发现缺陷必须跨越白名单，先写入本记录提出问题，不直接改共享文件。
- 所有提交落在 `gpt` 分支；完成后记录文件、commit SHA、CI URL、测试数和未覆盖风险。
- 生产 BUY/SELL 与 Simple Earn 自动赎回保持关闭，不使用真实资金测试。

### 当前基线
- CI run `44481270903` 全量失败，39/40 测试文件通过、326 项测试通过；唯一已知失败为上述 SELL guard 用例。BUY/IndexedDB 两个 GPT 测试文件已通过。
- 必须先修复任务 1，再以全量 CI 绿色作为后续任务验收基线。
