# V3.3 执行层

本目录 `lib/execution/` 是执行层开发入口。策略参数以根目录 `策略3.3.xlsx` 与 `docs/策略3.3/策略3.3用户确认决策.md` 为准；本文只说明架构与安全边界。

## 当前实现状态（2026-11-21）

1. **本地 Trader：** `npm run trader` 启动独立 Node 进程，不依赖浏览器；SQLite持久化、单实例锁、BUY intent/提交/对账恢复已有代码。Trader Testnet BUY/SELL授权和Binance环境由`AUTO_TRADE_MODE=testnet`派生，不要求手动维护两组订单开关。
2. **SELL：** `enqueueServerSellSignals` 将信号写入SQLite；`server/sell-execution.ts` 由Trader调用，完成账户成交台账/余额核验、交易规则预检、底仓保护、提交前持久化clientOrderId、SELL POST、原ID只读查单、逐笔成交核验、台账/Outbox写入和终态/部分成交状态。浏览器旧自动交易循环已移除，浏览器端现货下单开关永久关闭；旧IndexedDB队列只作为历史记录展示，不参与Trader执行。当前仅有Mock测试，尚未完成Testnet真实订单验收。
3. **订单未知态：** BUY POST 前持久化 clientOrderId；异常进入 unknown 并排队只读对账。禁止未知订单盲目重发。仍需进程级崩溃/重启验收。
4. **生产模式：** `AUTO_TRADE_MODE=production` 当前明确拒绝启动真实交易；M0–M3 独立验收通过前不得解除。
4.5 **策略后处理：** 服务端看板和本地Trader统一通过只读SQLite历史读取已确认SELL事件/成交台账，再执行止盈后均价回补与顺序止盈计算；不再从浏览器IndexedDB读取执行历史。
5. **通知/Earn：** 成交确认写入SQLite Outbox；本地Trader使用租约领取、SMTP直发、指数退避，失败10次转人工复核。仅`TRADE_FILL_MAIL_ENABLED=1`时发送，默认关闭；尚未用用户SMTP账户实测。Simple Earn服务端入口仍明确拒绝提交。
6. **自检/日志：** Testnet/production启动自检现在会实际读取Binance账户权限（canTrade必须true、canWithdraw必须false）、USDT余额、Binance服务器时间偏差及数据/SQLite目录可写；仍需Testnet实测并补数据库实际写入/锁联动验收。Trader连续异常熔断已接入；日志已脱敏并按UTC日期写入`data/logs/trader-YYYY-MM-DD.log`，目录和文件分别限制0700/0600权限。

## 主要模块

| 模块 | 职责 |
|------|------|
| `sell-signal-queue.ts` / `sell-guard.ts` | 卖出信号计算、台账核验、底仓/周期仓保护 |
| `server/sell-enqueue.ts` | 将策略 SELL 信号写入本地 SQLite；台账读取失败时fail-closed |
| `server/sell-execution.ts` | 本地Trader SELL预检、提交、unknown只读恢复、成交核验与入账 |
| `server/sqlite-store.ts` | intent、reservation、scheduler、SELL event、ledger、Outbox 持久化 |
| `server/trader-loop.ts` | BUY intent、提交与订单只读恢复 |
| `binance-reconcile.server.ts` | Binance 只读查单/成交/余额/规则适配 |
| `server/safe-log.ts` | 脱敏控制台日志与按UTC日期分文件落盘 |
| `notification-outbox.ts` / `server/notification-outbox-dispatcher.ts` | 成交Outbox、SQLite租约、SMTP直发与退避重试 |

## 安全规则

- 仅交易所确认成交可改持仓/成本/档位。
- 止盈不得卖受保护底仓；底仓减仓单独授权。
- 止盈倍数与比例以策略 3.3 / 用户确认决策为准。
- STALE 数据不得用于执行。
- 不新增单日/单笔金额上限；按用户确认的策略3.3固定额度执行。
- 生产 BUY/SELL 与 Simple Earn 真实赎回默认关闭；当前 production 启动硬拒绝。

## 当前验收证据

- SELL服务端执行、启动自检、SMTP Outbox与按日日志本轮CI：GitHub Actions Run `44880508488`，74 files / 522 tests通过，TypeScript typecheck与Next.js production build通过。该Run覆盖Outbox并发领取、SMTP投递门控/失败路径和日志脱敏落盘Mock；不代表真实SMTP邮箱已投递。
- 该 CI 只证明代码质量检查通过，不代表 Testnet 实盘订单、SMTP 真发或生产交易验收通过。
