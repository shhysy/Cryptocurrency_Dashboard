# V3.3 执行层

本目录 `lib/execution/` 是执行层开发入口。策略参数以根目录 `策略3.3.xlsx` 与 `docs/策略3.3/策略3.3用户确认决策.md` 为准；本文只说明架构与安全边界。

## 当前实现状态（2026-11-21）

1. **本地 Trader：** `npm run trader` 启动独立 Node 进程，不依赖浏览器；SQLite 持久化、单实例锁、BUY intent/提交/对账恢复已有代码。
2. **SELL：** 已实现服务端 SQLite 信号入队（`enqueueServerSellSignals`）；但 Trader 尚未调用服务端 SELL 提交与只读对账处理器。浏览器版 `runSellAutomationTick` 仍依赖 IndexedDB，不能算作本地常驻 SELL 闭环。
3. **订单未知态：** BUY POST 前持久化 clientOrderId；异常进入 unknown 并排队只读对账。禁止未知订单盲目重发。仍需进程级崩溃/重启验收。
4. **生产模式：** `AUTO_TRADE_MODE=production` 当前明确拒绝启动真实交易；M0–M3 独立验收通过前不得解除。
5. **通知/Earn：** 成交通知邮件模块目前是门控/正文占位实现，未真正发送 SMTP；Simple Earn 服务端入口仍明确拒绝提交。二者均未完成。
6. **自检/日志：** 已有基础目录可写、Key存在性和熔断/脱敏；真实账户权限、服务器时间偏差、余额/连通性等完整自检及按日文件轮转尚未完成。

## 主要模块

| 模块 | 职责 |
|------|------|
| `sell-signal-queue.ts` / `sell-guard.ts` | 卖出信号计算、台账核验、底仓/周期仓保护 |
| `server/sell-enqueue.ts` | 将策略 SELL 信号写入本地 SQLite |
| `server/sqlite-store.ts` | intent、reservation、scheduler、SELL event、ledger、Outbox 持久化 |
| `server/trader-loop.ts` | BUY intent、提交与订单只读恢复 |
| `binance-reconcile.server.ts` | Binance 只读查单/成交/余额/规则适配 |
| `notification-outbox.ts` | 成交通知事件与重试领域逻辑 |

## 安全规则

- 仅交易所确认成交可改持仓/成本/档位。
- 止盈不得卖受保护底仓；底仓减仓单独授权。
- 止盈倍数与比例以策略 3.3 / 用户确认决策为准。
- STALE 数据不得用于执行。
- 不新增单日/单笔金额上限；按用户确认的策略3.3固定额度执行。
- 生产 BUY/SELL 与 Simple Earn 真实赎回默认关闭；当前 production 启动硬拒绝。

## 当前验收证据

- 最新分支 CI：`d0fb1c879f0a8b429db06ef41ceace614adfc83c`，GitHub Actions Run `44874836137` 成功；测试、TypeScript typecheck、Next.js production build 步骤均成功。
- 该 CI 只证明代码质量检查通过，不代表 Testnet 实盘订单、SMTP 真发或生产交易验收通过。
