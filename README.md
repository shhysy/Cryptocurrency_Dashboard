# 长期投资信号看板

> **运行方式：本地优先。** 使用`npm run dev`在本机运行；交易执行依赖本地Node Trader和SQLite，不依赖Cloudflare Workers/OpenNext。仓库仍保留一条旧成交通知中转API的可选Access/Worker兼容分支，当前Trader的SMTP Outbox不依赖该分支。

周线级别的信号、持仓、成本价和交易执行研究看板。实盘买入、卖出与 Simple Earn 赎回由独立开关控制，当前全部关闭；未完成测试网演练前不得启用。

没有配置币安 Key 时自动显示示例数据。

## 本地运行

需要 Node.js 22 LTS（项目使用内置 `node:sqlite`）。

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

看板信号、持仓与成本在本机 Next.js 可用；浏览器不持有 Binance Secret。浏览器旧自动交易循环和浏览器端现货下单开关已关闭，本地Trader是唯一自动执行入口。当前 `npm run trader` 已有本地常驻进程、SQLite 存储、BUY执行/对账和SELL服务端提交/只读对账代码；SELL已接入服务端预检、底仓保护、成交核验和台账入账，并有Mock集成测试。已补SQLite真实文件+子进程SIGKILL+重启只读恢复集成测试；尚未完成专用Testnet真实订单演练、用户SMTP真实投递验证、Simple Earn服务端赎回及生产验收。SMTP Outbox与按日日志轮转代码已有Mock/CI验证。生产模式仍由代码硬拒绝。**当前版本不是可实盘版本，不能仅填真实 Key 就启动交易。**

## 策略逻辑

策略参数唯一来源为根目录 `策略3.3.xlsx`；用户确认项见 `docs/策略3.3/策略3.3用户确认决策.md`。

- **机会指数**：价格位置、情绪、趋势结构等（展示满分与门槛以配置为准）。
- **买入建议**：分数门槛 + 企稳 + 冷却；金额受单币上限与真实 USDT 余额约束。
- **卖出建议**：止盈档位、指标止盈、追踪止损、底仓减仓。

## 环境变量

见 `.env.example`。Trader只需在`.env.local`填写对应环境的Key/Secret并设置`AUTO_TRADE_MODE`；Testnet BUY/SELL授权由统一模式派生。真实Key/Secret只放本机`.env.local`，不要提交到Git。

- `APP_ORIGIN=http://localhost:3000`（本地同源校验）
- 生产 BUY/SELL 相关开关默认 `0`
- `TRADE_FILL_MAIL_ENABLED` 默认 `0`，仅本地Trader服务端启用后投递成交邮件

## 文档

- 执行层：`lib/execution/README.md`
- 落地路径：`docs/策略3.3/自动化交易落地路径.md`
- 任务清单：`自动交易系统总需求清单.md`
- 工作记录：`Grok工作记录.md` / `GPT工作记录.md`
