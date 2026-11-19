# GPT 工作记录

> 维护者：GPT
> 主开发分支：gpt
> 最后更新：2026-11-19
>
> **协作约定**：每次开始开发前，必须先读取本文件和 grok工作记录.md，核对已实现/未实现事项、分支及同一文件/策略语义的修改。若本文件不存在则创建；若发现冲突，先写明冲突与合并决策，再修改代码。

## 一、当前开发边界与安全规则
- 当前阶段以模拟测试、只读核验和代码安全加固为主。
- 生产现货 BUY/SELL 开关保持关闭；Simple Earn 自动赎回保持关闭。
- 不使用用户真实余额做开发测试，不发送真实订单，不申购/赎回/划转。
- API 密钥仅由用户在本地环境文件配置；仓库只保留示例变量，不写入真实 Key/Secret。
- 订单提交结果不明确时必须进入对账/人工复核，不得盲目重试以避免重复下单。
- 浏览器 IndexedDB/localStorage 是本地浏览器配置级数据，不等于交易所级资金锁，也不保证跨设备同步。

## 二、已实现（GPT 侧）

### A. 策略与止盈后回补
| 项目 | 位置 | 当前实现 |
|---|---|---|
| 2x / 3x / 5x 止盈档 | strategy.config.ts、strategy/engine.ts | 按当前周期仓比例 50% / 30% / 80%；严格按档位顺序，前档确认后才执行后档 |
| 止盈成交重放 | strategy/post-take-profit-rebuy.ts | 使用本地已确认卖出事件与成交台账重放持仓、成本和均价 |
| 止盈后均价回补 | 同上 | 任意止盈档有确认成交后，关闭旧头仓锚定补仓及备用金，只按当前均价的四档跌幅回补 |
| 新持仓周期重置 | 同上 | 持仓归零后退出本轮止盈/回补状态，新一轮重新按开仓规则 |
| 历史完整性保护 | 同上 | 台账缺失、成交不完整或重放持仓不匹配时 fail-closed，暂停该币策略操作 |
| 成本与净数量 | lib/binance.ts、lib/dashboard.ts | 处理基础币手续费净数量及买入成本，透传成交订单 ID |
| 说明文档 | STRATEGY.md、components/StrategyInfo.tsx、lib/execution/PHASE_28.md | 记录规则及本地历史存储边界 |

**重要限制**：本地卖出事件/成交台账存于当前浏览器 IndexedDB，清理站点数据或更换浏览器设备可能丢失；存在手动交易或外部成交而本地台账未记录时，系统会暂停策略而非猜测。

### B. 自动买入与执行可靠性
| 项目 | 位置 | 当前实现 |
|---|---|---|
| 待买订单和资金预留 | lib/execution/store.browser.ts 等 | IndexedDB 事务管理队列及资金预留 |
| 原子认领/幂等提交 | lib/execution/buy-order-submit.browser.ts、client-order-id.ts | 以 event/attempt 生成确定性 clientOrderId，避免同一任务重复提交 |
| 买入订单对账 | lib/execution/sync-buy-order.browser.ts | 按 clientOrderId 查询订单并核对逐笔成交 |
| 部分成交预留 | store.browser.ts | 已确认支出递减可用预留；未终态订单继续保持锁定 |
| 终态释放 | 同上 | 仅在交易所订单终态后释放未使用部分 |
| 成交唯一性 | fill-reconcile.ts、store.browser.ts | 按成交 ID 去重；重复成交数据冲突时拒绝记账 |
| 通知 Outbox | store.browser.ts、workers | 成交记录与通知事件原子写入，异步发送可重试 |
| 多标签页旧 attempt 防护 | buy-order-submit.browser.ts、sync-buy-order.browser.ts | 所有异步状态回写携带原 attempt；过期任务不能覆盖新 attempt |
| 买入成交台账一致性 | store.browser.ts | 重复 BUY fill 同时核验 fill 索引和 ledger 记录，缺一或内容冲突则 fail-closed |

### C. 验证记录
- Phase 28 代码提交曾通过 37 个测试文件、280 个测试。
- Phase 29（2026-11-19）新增买入对账 attempt 防护测试，并加强重复 BUY fill 台账核验。
- Phase 29 验证：38 个测试文件通过、284 个测试通过、tsc --noEmit 通过。
- CI：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44475066618
- Phase 29 代码提交：af98fce8ec985dc63b57f845da85ae2542d18f40
- Phase 29 文档提交：ee0b7aef1e6618c2eb564c211d2c1aebfc150f6f

## 三、未实现 / 仍需验证
| 优先级 | 项目 | 当前状态 / 风险 |
|---|---|---|
| P0 | 资金预留全链路压力测试 | 仍需覆盖两个标签页同时认领、并发预留、部分成交/终态交错、浏览器崩溃恢复等竞争场景 |
| P0 | 买入订单状态管理中心 | 已新增只读总览 ExecutionStatusPanel：汇总买卖待处理数、需对账数、活动资金预留、通知待处理；更细的逐笔恢复/人工处理工作流仍未完成 |
| P0 | IndexedDB 恢复与损坏处理 | 需进一步验证升级、事务中断、站点数据清理、重复初始化等情形 |
| P1 | 自动卖出完整闭环 | 有 SELL 提交/核验基础，但未完成全链路模拟验收；实盘开关仍关闭 |
| P1 | 止盈后回补与预备订单计划统一 | 主策略已接入 post-take-profit-rebuy；Grok 侧另有 prep-order 计划层，存在双轨语义，需要先对齐 |
| P1 | 历史底仓比例 | 当前回放保护底仓仍需检查是否应严格按每笔买入历史 baseRatioAtBuy 计算，而非当前 profile |
| P1 | 外部/手动交易同步 | 未建立可靠的交易所全量成交导入和跨设备同步；本地台账不完整时应继续暂停 |
| P2 | 行情实时性 | 尚未实现 WebSocket 实时触价；当前以定时刷新/缓存为主 |
| P2 | 交易执行服务端化 | 浏览器本地执行队列不具备跨设备单实例调度和交易所级互斥能力，尚未迁移为可靠服务端调度器 |
| P2 | 生产联调与风险演练 | 尚未完成；不得把 mock/CI 通过描述为真实交易测试 |

## 四、与 Grok 工作记录的冲突检查（2026-11-19）
已读取 grok工作记录.md，并检查其所述预备订单文件与当前 GPT 主策略的关系。

### 发现的差异
1. Grok 记录的 lib/execution/prep-orders.ts、prep-orders-csv.ts、prep-store.browser.ts、components/PrepOrdersPanel.tsx 是计划/CSV/UI 层。
2. GPT 主策略的止盈后均价回补位于 strategy/post-take-profit-rebuy.ts，基于确认的交易成交台账驱动实际策略信号。
3. Grok 记录明确说明预备订单目前不会自动下单，且不会自动侦测交易所止盈；需要手动点「记止盈」。
4. 因此两者目前不是同一执行真源：一个是用户维护的计划状态，一个是成交台账驱动的策略状态。若不明确边界，UI 可能显示的预备订单与自动策略队列不同步。

### 当前处理决定
- 暂不删除或覆盖 Grok 的预备订单模块。
- 暂不把 CSV/localStorage 计划状态接入自动下单。
- 自动策略的止盈/回补判断继续以已确认成交事件和执行台账为准。
- 下一次改动预备订单前，先逐文件对照其数据模型、状态转换和 Dashboard 挂载点，再决定将其明确标为「人工计划/导出工具」，或设计只读投影映射到主策略；禁止形成第二个可独立下单的信号源。
- 已按 Grok 记录确认：唯一开发分支为 gpt；grok 分支废弃，不再作为开发线。所有协作提交均落在 gpt。

## 五、每次开工前检查清单
- [ ] 读取 gpt工作记录.md 最新版本。
- [ ] 读取 grok工作记录.md 最新版本。
- [ ] 获取 gpt 分支 HEAD，检查两份记录对应的代码是否已变化。
- [ ] 确认本次改动文件是否与另一方工作重叠。
- [ ] 若策略语义/数据真源冲突，先记录决策再改代码。
- [ ] 修改后更新本文件：已实现、未实现、测试结果、commit SHA、CI URL。
- [ ] 不启用真实交易，不使用真实资金做测试。

## 六、变更日志
| 日期 | 摘要 |
|---|---|
| 2026-11-19 | 创建 GPT 工作记录；读取并核对 grok工作记录.md；确认预备订单计划层与成交台账驱动主策略存在双轨状态风险；记录 Phase 29 买入 attempt fencing 与重复成交台账核验；新增只读执行状态总览面板。 |


## 七、Phase 30 — 执行状态总览（已完成）

- 新增 `components/ExecutionStatusPanel.tsx`，只读汇总买入/卖出待处理订单、需对账数量、活动资金预留金额和通知待处理数。
- 在 Dashboard 的队列 Tab 和主页面挂载总览。
- 该面板只读取现有 IndexedDB stores，不创建订单、不释放资金、不触发对账、不发送交易。
- 验证通过：38 个测试文件、284 个测试通过，`tsc --noEmit` 通过。
- CI：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44477012135
- 面板代码提交：`7df38d462b00efdd46f69351eb972298806d1564`；Dashboard 挂载提交：`3bc72689986c91205ec8f142c3e1e48391d5ccd5`。
- 与 Grok 预备订单模块无文件重叠，本阶段不修改 prep-orders / PrepOrdersPanel，也不将 CSV 计划作为自动执行真源。
