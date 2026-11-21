# 长期投资信号看板

> **运行方式：本地优先。** 使用 `npm run dev` 在本机运行；不依赖 Cloudflare Workers / OpenNext 部署。

周线级别的信号、持仓、成本价和交易执行研究看板。实盘买入、卖出与 Simple Earn 赎回由独立开关控制，当前全部关闭；未完成测试网演练前不得启用。

没有配置币安 Key 时自动显示示例数据。

## 本地运行

需要 Node.js 20.9 以上（推荐 22 LTS）。

```bash
npm install
cp .env.example .env.local
# 编辑 .env.local：BINANCE_*、APP_ORIGIN=http://localhost:3000、邮件等
npm run dev      # http://localhost:3000
npm test
npm run typecheck
```

`DASHBOARD_PASSWORD` 留空则直接打开；设置后浏览器会弹出登录框。

## 当前完成边界（本地优先）

看板信号、持仓与成本在本机 Next.js 可用；浏览器不持有 Binance Secret。统一 `/api/binance/spot-order` 提供 BUY/SELL MARKET 入口，方向开关默认关闭。SELL 状态机（含 01A 台账混合冲突 fail-closed）已代码交付，待 GPT 独立复核。执行层正迁向**本地常驻进程 + 本机持久化**（GPT 主责），不再以 Cloudflare DO/Worker 为部署目标。Simple Earn 真实赎回关闭。未完成 Testnet 全链路与用户授权前，不得开启生产交易。

## 策略逻辑

策略参数唯一来源为根目录 `策略3.3.xlsx`；用户确认项见 `docs/策略3.3/策略3.3用户确认决策.md`。

- **机会指数**：价格位置、情绪、趋势结构等（展示满分与门槛以配置为准）。
- **买入建议**：分数门槛 + 企稳 + 冷却；金额受单币上限与真实 USDT 余额约束。
- **卖出建议**：止盈档位、指标止盈、追踪止损、底仓减仓。

## 环境变量

见 `.env.example`。真实 Key/Secret 只放本机 `.env.local`，不要提交到 Git。

- `APP_ORIGIN=http://localhost:3000`（本地同源校验）
- 生产 BUY/SELL 相关开关默认 `0`
- `NEXT_PUBLIC_TRADE_FILL_DISPATCH_ENABLED` 默认关

## 文档

- 执行层：`lib/execution/README.md`
- 落地路径：`docs/策略3.3/自动化交易落地路径.md`
- 任务清单：`自动交易系统总需求清单.md`
- 工作记录：`Grok工作记录.md` / `GPT工作记录.md`
