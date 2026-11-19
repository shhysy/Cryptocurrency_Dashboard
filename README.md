# 长期投资信号看板

周线级别的信号、持仓、成本价和交易执行研究看板。实盘买入、卖出与 Simple Earn 赎回由独立开关控制，当前全部关闭；未完成测试网演练前不得启用。

没有配置币安 Key 时自动显示示例数据，页面顶部可切换 5 种结论状态预览。

## 本地运行

需要 Node.js 20.9 以上（推荐 22 LTS）。先复制 `.env.example` 为 `.env.local`，密钥只填写在本地文件。`.env.local` 已加入 Git 忽略规则。

```bash
npm install
cp .env.example .env.local     # Windows: copy .env.example .env.local
# 编辑 .env.local：DASHBOARD_PASSWORD、BINANCE_API_KEY / SECRET
# 国内本机建议设置 PROXY_URL（见下方「环境变量速查」）
npm run dev      # http://localhost:3000
npm test         # 策略引擎单元测试
```

`DASHBOARD_PASSWORD` 留空则直接打开；设置后浏览器会弹出登录框，用户名随意，密码就是该值。部署相关变量说明见下文 **环境变量速查**。

## 目录结构

```
strategy.config.ts      策略参数（RSI、MA200、恐惧贪婪、得分档位、汇率…）
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

## Binance Spot Testnet（测试网）

本项目支持通过独立环境变量切换 Binance Spot Testnet，测试网凭证不会回退到生产 Key/Secret：

```dotenv
NEXT_PUBLIC_DIRECT_BINANCE=1
NEXT_PUBLIC_BINANCE_SPOT_TESTNET=1
NEXT_PUBLIC_BINANCE_TESTNET_API_KEY=你的测试网_API_Key
NEXT_PUBLIC_BINANCE_TESTNET_API_SECRET=你的测试网_API_Secret
```

使用步骤：
1. 在 Binance Spot Testnet 官方环境创建测试网 API Key/Secret；不要填写生产账户 Key。
2. 在本地 `.env.local` 配置以上变量，重启 Next.js 开发服务器。
3. 确认代码导出的 `BINANCE_SPOT_ENVIRONMENT` 为 `testnet`，接口地址为 `https://testnet.binance.vision`。
4. 使用测试网资产验证余额读取、交易对规则、订单提交/查询、逐笔成交对账和异常恢复。
5. 测试网不提供 Simple Earn；本项目在 Testnet 模式会主动拒绝所有 Simple Earn 读取/赎回路径，不会误访问生产理财接口。

**当前阶段边界：** Testnet 模式已完成 Spot REST 地址/凭证隔离和 Simple Earn 拦截，但 Testnet BUY/SELL 提交按钮与自动执行调度尚未接入 Testnet 专用开关，因此目前仍不能通过看板发出 Testnet 订单。`LIVE_SPOT_ORDER_SUBMISSION_ENABLED`、`LIVE_SPOT_SELL_SUBMISSION_ENABLED`、`LIVE_EARN_REDEMPTION_ENABLED` 均保持 `false`。本地单元测试不会访问 Binance，也不会产生订单。真实 Testnet 下单演练必须在单独接入 Testnet 执行入口后进行，不能修改生产开关代替测试。
## 安全提醒

- 当前自动赎回/买卖实盘开关均关闭，现有只读 Key 不会执行资金变动；Spot Testnet 使用独立凭证和独立接口地址。
- 私人浏览器直连模式会把 `NEXT_PUBLIC_BINANCE_API_SECRET` 打进前端 bundle；这不是安全存储。若你接受该风险，也必须使用专用 Key、固定 IP 白名单，并且只开放必要的现货/理财交易权限，绝不开放提现、划转或合约权限。
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

### 方案 C：Cloudflare Workers（本仓库已按此部署）

需要 `@opennextjs/cloudflare` 适配器，按官方文档配置 `wrangler` 后部署。密钥在 Cloudflare 控制台 **Settings → Variables and Secrets** 里添加（类型选 Secret），不要写进 `wrangler.toml` / `wrangler.jsonc`。

Cloudflare 出口 IP 不固定，**不能**做币安 IP 白名单；部分机房 IP 会被币安拦截。本项目已支持 **浏览器直连**（见下方环境变量），用用户本机宽带访问币安公开/签名接口，绕过 Workers 出口限制。

### 环境变量速查（稳定性相关）

| 变量 | 本机开发 | Cloudflare 生产 | 作用 |
|------|----------|-----------------|------|
| `PROXY_URL` | 国内常需要，填本地代理如 `http://127.0.0.1:7897` | **不要设**（Workers 用不了你电脑的代理） | Node 服务端经代理访问币安；不设则直连 |
| `NEXT_PUBLIC_DIRECT_BINANCE` | 一般 `0`（本机 Node 直连或走 `PROXY_URL`） | **建议 `1`**（见 `.env.production`） | `1` = 服务端不调币安，由**浏览器**直发请求（需本机可访问币安；部分环境要配合浏览器 CORS 扩展） |
| `ENABLE_ACCOUNT` | 有 Key 且要金额建议时保持默认（开启） | 若只看信号、或账户接口易超时，可设 **`0`** | `0` = 不读余额/成交，**只出方向**，请求更少、更快；`1`/未设 = 读账户并尽量给出买入金额 |
| `BINANCE_API_KEY` / `SECRET` | 填只读 Key | 用 Secret 配置 | 账户与成交需要；仅行情信号可不配（或 `USE_MOCK=1`） |
| `BINANCE_BASE_URL` | 可选，自建现货反代 | 可选 | 转发现货 `/api/v3/*` |
| `BINANCE_FAPI_URL` | 可选，自建合约反代 | 可选 | 原油 CL 等 U 本位行情默认 `https://fapi.binance.com` |

**本机（国内）推荐：**

```bash
# .env.local
PROXY_URL=http://127.0.0.1:7897   # 改成你的代理端口；能直连币安则可留空
ENABLE_ACCOUNT=1                  # 要买入金额就开；经常超时可先改 0 只看方向
# NEXT_PUBLIC_DIRECT_BINANCE 不要开（本机走 Node + 代理即可）
```

**Cloudflare 生产推荐：**

```bash
# 在 CF Secrets / .env.production
NEXT_PUBLIC_DIRECT_BINANCE=1      # 浏览器直连，避开 Workers 出口被拦
ENABLE_ACCOUNT=0                  # 可选：只要信号、少打账户接口时更快更稳
# 不要设置 PROXY_URL
```

说明：

- 浏览器直连模式下，Key 和 Secret 会进入前端 bundle（见 `lib/credentials.ts` / `binance.browser.ts`）。仅限私人自用，并应绑定固定家宽 IP；不要复用其他服务的 API Key。当前真实赎回/买卖开关保持关闭。
- `ENABLE_ACCOUNT=0` 时策略仍打分、仍给出「买/卖/暂缓」方向，但不会根据真实余额算建议金额。
- 原油 CL 走币安 U 本位永续公开行情（`fapi`），与现货直连同一套部署思路；**无需改接口代码**，只配环境变量即可。

### 国内网络

本机或国内服务器可能连不上 `api.binance.com` / `fapi.binance.com`。本机用 `PROXY_URL`；或用海外 VPS；或自建反向代理并设置 `BINANCE_BASE_URL`（现货）/ `BINANCE_FAPI_URL`（合约）。

## 免责声明

信号仅供参考，不构成投资建议。加密货币波动剧烈，请控制仓位。
