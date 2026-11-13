# 长期投资信号看板

只读的单页看板：周线级别的信号、持仓、成本价、买入记录。**不能下单、不能交易**，代码里只有 GET 请求。

没有配置币安 Key 时自动显示示例数据，页面顶部可切换 5 种结论状态预览。

## 本地运行

需要 Node.js 20.9 以上（推荐 22 LTS）。

```bash
npm install
cp .env.example .env.local     # Windows: copy .env.example .env.local
# 编辑 .env.local，填 DASHBOARD_PASSWORD；有 Key 再填 BINANCE_API_KEY / SECRET
npm run dev      # http://localhost:3000
npm test         # 策略引擎单元测试
```

`DASHBOARD_PASSWORD` 留空则直接打开；设置后浏览器会弹出登录框，用户名随意，密码就是该值。

## 目录结构

```
strategy.config.ts      策略阈值（RSI、MA200、恐惧贪婪、得分档位、汇率…）
watchlist.config.ts     关注币种，加币只需加一行
strategy/        策略引擎（纯函数，不依赖框架）+ 单元测试
  indicators.ts           RSI / 均线 / 回撤
  cost.ts          成本价计算、成交合并去重
  engine.ts        单币信号 + 今日结论
lib/
  binance.ts       币安接口（HMAC SHA256 签名，只读）
  service.ts       取数 + 缓存 + 失败回退；mock / 真实数据切换
  dashboard.ts     汇总：持仓、曲线、买入记录（mock 与真实共用）
  mock.ts          示例数据与 5 个演示场景
  cache.ts         内存缓存（TTL，失败时回退上次数据）
proxy.ts  访问密码（Next 16 里 middleware 改名为 proxy）
app/      页面与 /api/dashboard
components/      Hero / Overview / CoinCard / Timeline / StrategyInfo
data/manual-trades.json 手动导入的买入记录
```

## 策略逻辑

规则来自《长期投资策略 V3.3》表格，实现了信号层和建议金额，完整说明见 [STRATEGY.md](STRATEGY.md)。

- **机会指数（满分 90）**：价格位置（周线 RSI 与 MA200 折减合并，≤45）+ 情绪（恐惧贪婪，≤30）+ 趋势结构（企稳每项 5 分，≤15）。每个币都有分数。
- **分组**：BTC、PAXG 为积极型，其余为保守型（门槛更高、金额更小）。
- **买入建议**：分数达到门槛 + 企稳 + 过了冷却期，给出头仓、补仓（4 档）或备用金，金额按 BTC 市场状态缩放，再被单币、现金、单周新增、山寨 / 核心合计等上限压低。
- **卖出建议**：止盈档位、指标止盈、追踪止损、底仓减仓。
- 开启 `ENABLE_ACCOUNT=1` 才会读取余额和成交，才能给出买入金额；否则只给方向。

## 成本价计算

加权平均，**只统计买入**，手续费计入成本：

```
平均成本 = Σ(价格 × 数量 + 手续费) ÷ Σ 数量
```

- 手续费以买到的币扣除：按成交价折算成 USDT。以 USDT 扣除：原值。以 BNB 等其他币扣除：**按 0 处理**（误差通常小于 0.1%）。
- 要不含手续费，把 `lib/dashboard.ts` 里的 `INCLUDE_FEE` 改成 `false`。
- 看板不处理卖出对成本的影响。卖出后平均成本仍按全部买入计算。
- 持仓数量取账户实际余额；若余额明显大于买入记录合计，页面底部会提示成本价可能不准。

## 买入记录来源与手动导入

1. 币安 `myTrades`：按关注币种逐个交易对读取（每页 1000 条，最多 5 页）。**只能查到 USDT 交易对**，且受币安历史范围限制。
2. 手动导入：编辑 `data/manual-trades.json`，或把 CSV 转成 JSON：

```bash
node scripts/import-csv.mjs data/manual-trades.example.csv
```

字段：`date, symbol, price, qty`，可选 `fee`（USDT）。

合并去重规则：同币种 + 同一天(UTC) + 同价 + 同量视为同一笔，保留币安数据。

理财、合约、其他交易所、站外转入的币，接口读不到，只能手动导入。

## 缓存

| 数据 | 缓存时间 |
|---|---|
| 行情 | 1 分钟 |
| 账户余额 | 3 分钟 |
| 成交记录 | 15 分钟 |
| 周线 K 线 | 30 分钟 |
| 恐惧贪婪指数 | 30 分钟 |

接口失败时显示上次缓存，并标注「数据更新时间」。缓存在进程内存里：Serverless 冷启动会丢失，此时若接口也失败，页面会显示「暂时无法获取数据」。

## 安全提醒

- API Key 只勾**读取**权限，不要勾交易、提现。
- 能绑定 IP 白名单就绑定（固定 IP 的服务器可以，Cloudflare Workers 不行）。
- `.env.local` 不要提交 Git、不要发给任何人或贴进聊天。已经泄露的 Key 立刻在币安删除重建。
- `DASHBOARD_PASSWORD` 留空时页面不需要密码，仅适合只在本机使用。部署到公网必须设置，否则任何人打开地址都能看到你的资产。
- 这是 Basic Auth，请用 HTTPS 访问，否则密码是明文传输。
- Key 只在服务端读取，不会进入前端代码。

## 部署

### 方案 A：自有服务器 / VPS（推荐）

可以绑定固定 IP 白名单，也不受币安地区限制影响。

```bash
npm ci && npm run build
DASHBOARD_PASSWORD=xxx BINANCE_API_KEY=xxx BINANCE_API_SECRET=xxx npm start   # 默认 3000 端口
```

用 pm2 / systemd 守护进程，前面放 Caddy 或 Nginx 做 HTTPS。

### 方案 B：Vercel

导入仓库，在 Project Settings → Environment Variables 填三个变量。出口 IP 不固定，不能做白名单。

### 方案 C：Cloudflare Workers

需要 `@opennextjs/cloudflare` 适配器，按官方文档配置 `wrangler` 后部署，密钥用 `wrangler secret put` 设置，不要写进 `wrangler.toml`。

**本项目没有在 Cloudflare 上验证过。** 另外两个限制：出口 IP 不固定，不能做白名单；币安会对部分机房 IP 返回 451，遇到就改用方案 A。

### 国内网络

本机或国内服务器可能连不上 `api.binance.com`。可以走系统代理，或用海外服务器，或自建反向代理并设置 `BINANCE_BASE_URL`。

## 免责声明

信号仅供参考，不构成投资建议。加密货币波动剧烈，请控制仓位。
