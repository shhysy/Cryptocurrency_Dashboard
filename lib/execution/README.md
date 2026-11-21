# V3.3 执行层

本目录 `lib/execution/` 是执行层开发入口。策略参数以根目录 `策略3.3.xlsx` 与 `docs/策略3.3/策略3.3用户确认决策.md` 为准；本文只说明架构与安全边界。

## 当前架构（本地优先）

1. **行情与账户：** Dashboard 经 `/api/dashboard`；签名只读经 `/api/binance/signed-read`。Key/Secret 仅本机 `.env.local`。
2. **执行编排（目标）：** 看板只读；**本地常驻进程**（规划 `npm run trader`，GPT 主责）跑节拍、对账、恢复。浏览器 `ExecutionBackground` + IndexedDB 为过渡；**不依赖 Cloudflare Worker / Durable Object 部署**。
3. **订单边界：** BUY/SELL 经 `/api/binance/spot-order`；Testnet/Production 四路开关隔离，生产默认关。结果不明按 `clientOrderId` 只读查单，禁止盲目重发。
4. **通知：** 分数邮件走本机 SMTP。成交通知 Outbox 默认关；本地可不配外部 Worker。

## 主要模块（摘要）

| 模块 | 职责 |
|------|------|
| `sell-signal-queue.ts` / `sell-guard.ts` | 卖出入队、底仓/周期仓保护 |
| `sell-store.browser.ts` | 卖出事件持久化（过渡 IndexedDB） |
| `binance-reconcile.server.ts` | 只读查单/成交/余额 |
| `notification-outbox.ts` | 成交通知租约与幂等 |
| `app/api/execution/intents` | Testnet intent 入口；本地无执行账户绑定时 503 |

## 安全规则

- 仅交易所确认成交可改持仓/成本/档位。
- 止盈不得卖受保护底仓；底仓减仓单独授权。
- 止盈倍数与比例以策略 3.3 / 用户确认决策为准。
- STALE 数据不得用于执行。
- 生产 BUY/SELL 与 Simple Earn 真实赎回默认关闭。

## 验收

- `npm test` / `npm run typecheck` / `npm run build`
- Testnet 实测与用户授权前不得开启生产交易
- 历史 Cloudflare DO 集成测试脚本已移除；DO 相关源码仅作迁移参考
