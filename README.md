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

策略参数唯一来源为根目录 [策略3.3.xlsx](策略3.3.xlsx)；用户确认的A–G覆盖项见[决策记录](docs/策略3.3/策略3.3用户确认决策.md)，代码核对与测试状态见[规则实现矩阵](docs/策略3.3/策略3.3规则实现矩阵.md)。

- **机会指数（满分 90）**：价格位置（周线 RSI 与 MA200 折减合并，≤45）+ 情绪（恐惧贪婪，≤30）+ 趋势结构（企稳每项 5 分，≤15）。每个币都有分数。
- **分组**：BTC、PAXG 为核心积极型；ETH及其他保守型资产按保守参数执行。
- **买入建议**：分数达到门槛 + 企稳 + 过了冷却期，给出头仓、补仓（4 档）或备用金；金额按市场状态系数调整，并受单币固定成本上限及执行前真实 USDT 可用余额约束。
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

测试网/生产环境通过服务端环境变量切换，密钥只由 Next.js 服务端读取。不要使用任何 `NEXT_PUBLIC_*` 变量存放 API Key 或 Secret。

本地配置示例（放在未跟踪的 `.env.local`）：

```dotenv
BINANCE_SPOT_ENVIRONMENT=testnet
NEXT_PUBLIC_BINANCE_SPOT_TESTNET=1
BINANCE_TESTNET_API_KEY=你的测试网_API_Key
BINANCE_TESTNET_API_SECRET=你的测试网_API_Secret
ENABLE_ACCOUNT=1
```

生产环境改为：

```dotenv
BINANCE_SPOT_ENVIRONMENT=production
BINANCE_API_KEY=你的生产_API_Key（按需开启现货交易权限）
BINANCE_API_SECRET=你的生产只读_API_Secret
```

测试网模式固定使用 `https://testnet.binance.vision`，只读取测试网凭证，不会回退到生产 Key；生产模式只读取生产凭证。测试网不支持 Simple Earn，因此测试网环境会拒绝 Simple Earn 路径。

**当前完成边界：** Dashboard 的账户与行情请求已切换到 Next.js 服务端，浏览器不持有 Binance Secret；统一 `/api/binance/spot-order` 已提供 BUY/SELL MARKET 服务端入口，并在提交前复核交易对状态、USDT报价、市场过滤器、价格和账户可用余额。环境与方向开关由服务端独立控制，生产BUY/SELL默认关闭。最新分支CI Run `44761482631` 已通过：52个测试文件、440项测试全部通过，并通过TypeScript typecheck、Next.js production build和Cloudflare OpenNext build；自定义Worker入口、账户级Durable Object SQLite基础表、内部幂等订单意图落库、transactionSync原子claim、单活动订单锁、资金预留及attempt/clientOrderId/leaseToken持久化、每分钟Cron看门狗和DO Alarm心跳已进入开发分支，但尚未部署；claim、提交前submitting持久化、unknown冻结、过期租约reconcile-only接管、有效租约续期、逐笔成交核对、手续费计入预留消耗、订单终态结算和账户锁释放的DO内部原语已实现，但尚未接入Next.js可信策略事件、Binance真实余额/下单/查单/成交历史适配器；P2-C仅新增了任务类型白名单、稳定任务ID/dueAt校验、30秒fencing租约和有上限指数退避纯函数；DO SQLite enqueue/claim/ack/retry接口、Alarm过期租约回收/最近任务调度、Cron消费器、真实SQLite重启恢复和跨设备执行尚未完成。Worker Cron可在Testnet扫描与intent创建开关显式开启时重新计算策略信号并创建幂等DO intent；扫描开关默认关闭，且Cron仍不会提交新订单。关闭页面后Worker Cron可持续恢复已持久化的submitting/unknown订单，因此目前仍不能视为完整无人值守自动交易。SELL状态机仍待GPT独立验收。Simple Earn真实赎回仍关闭。服务端执行架构评审稿见[服务端自动执行架构设计](docs/策略3.3/服务端自动执行架构设计.md)。

## 服务端策略意图入口（Testnet开发阶段）

新增同源 `POST /api/execution/intents`，由服务端重新调用 `getDashboard()` 计算策略3.3信号，不接受浏览器提交的价格、评分、方向或下单金额。入口会拒绝Mock/STALE/过期数据，读取Binance free余额并核验交易对TRADING状态、USDT报价、LOT_SIZE、PRICE_FILTER、MIN_NOTIONAL/NOTIONAL；SELL按基础资产free余额检查，BUY只检查USDT free余额。事件ID按币种、动作类型和ISO周生成，重复请求幂等写入Durable Object intent。

手动调用启用条件必须同时满足：
- `BINANCE_SPOT_ENVIRONMENT=testnet`
- `BINANCE_TESTNET_INTENT_CREATION_ENABLED=1`
- 对应方向的服务端开关 `BINANCE_TESTNET_BUY_ENABLED` 或 `BINANCE_TESTNET_SELL_ENABLED` 为 `1`
- 已设置 `DASHBOARD_PASSWORD` 并使用同源认证请求
- 已配置Testnet账户Key且 `ENABLE_ACCOUNT=1`，返回数据必须是新鲜Binance数据

后台自动扫描还需额外设置 `BINANCE_TESTNET_INTENT_SCAN_ENABLED=1`。Worker Cron每分钟通过自引用Service Binding调用同一个服务端入口；必须至少开启一个Testnet方向开关。

该入口只创建DO订单意图，响应明确返回 `orderSubmitted=false`；不会调用Binance订单POST，不会开启BUY/SELL开关。默认关闭，未设置该变量时拒绝创建。生产环境硬拒绝此入口。

```dotenv
BINANCE_SPOT_ENVIRONMENT=testnet
BINANCE_TESTNET_INTENT_CREATION_ENABLED=0
BINANCE_TESTNET_INTENT_SCAN_ENABLED=0
```

该入口已接入受控的Worker Cron扫描，但后台扫描开关默认关闭；创建intent不等于订单已经提交，也不代表自动交易闭环完成。

## 安全提醒

- 本地密钥放在 `.env.local`；该文件已被 Git 忽略。GitHub 只提交无密钥的 `.env.example`。
- 已经发到聊天或提交到仓库的密钥应在 Binance 后台撤销并重新生成；删除文件不会让旧密钥失效。
- 测试网与生产凭证完全分离；测试网缺少凭证时不会使用生产凭证兜底。
- 生产交易开关默认关闭；不开放提现、划转或合约权限。
- 部署到公网必须配置 `DASHBOARD_PASSWORD` 并启用 HTTPS。
- `ENABLE_ACCOUNT=0` 时只读取公开行情，不读取账户余额和成交。

## 免责声明

信号仅供参考，不构成投资建议。加密货币波动剧烈，请控制仓位。


### Spot 下单接口（测试网与生产环境隔离）

旧服务端 `/api/binance/testnet-order` 仍是测试网专用入口，生产模式硬拒绝。自动交易统一调用 `/api/binance/spot-order`，由服务端 `BINANCE_SPOT_ENVIRONMENT` 选择 endpoint 与凭证，并独立校验对应环境的 BUY/SELL 开关。浏览器不会持有 Secret。

必须同时设置前后端两个独立开关，且需要先配置 `DASHBOARD_PASSWORD`：

```dotenv
BINANCE_SPOT_ENVIRONMENT=testnet
NEXT_PUBLIC_BINANCE_SPOT_TESTNET=1
BINANCE_TESTNET_BUY_ENABLED=1
NEXT_PUBLIC_BINANCE_TESTNET_BUY_ENABLED=1
BINANCE_TESTNET_SELL_ENABLED=1
NEXT_PUBLIC_BINANCE_TESTNET_SELL_ENABLED=1
DASHBOARD_PASSWORD=请设置一个强密码
```

BUY 和 SELL 可分别开启；首次联调建议只开启 BUY，验证流程后再单独开启 SELL。任何一侧缺少对应环境的前端或服务端开关都会拒绝请求。生产环境对应开关为 `BINANCE_PRODUCTION_BUY_ENABLED` / `BINANCE_PRODUCTION_SELL_ENABLED`，默认均为 `0`。提交结果不明确时只保留 clientOrderId 并进入对账，不自动重发。

注意：队列买入仍依赖账户余额、交易对规则和本地资金预留；卖出仍依赖本地成交账本与 Binance 持仓核对。不要为了通过测试而绕过这些保护。


安全说明：测试网下单 API 除全站 Basic Auth 外，还会独立校验 `Authorization: Basic` 密码；必须设置强 `DASHBOARD_PASSWORD` 并通过 HTTPS 部署。API 路由的认证、跨源、JSON、请求体大小和字段白名单测试均纳入 Vitest。

## 策略3.3用户确认的实现差异

用户已选择A2/B2/C2/D2/E2/F2/G2，详见[用户确认决策](docs/策略3.3/策略3.3用户确认决策.md)。BTC/PAXG为核心积极型，ETH按保守型处理；保留五档评分与100分制展示；积极型止盈倍数2/3/5、保守型1.3/1.6/2，三档比例为50/30/80；固定单币额度不按账户净值比例压缩；自动执行架构继续开发但LIVE默认关闭；展示层软失败必须标记STALE，执行侧不得将STALE数据视为新鲜数据。H项未选择。代码核对状态以[规则实现矩阵](docs/策略3.3/策略3.3规则实现矩阵.md)为准。

特别说明：E2意味着账户净值比例风控不作为当前执行层硬限制，README中不得再暗示现金比例、核心/山寨净值额度、单周新增和组合回撤阈值已全部强制执行。G2也不代表stale数据可以用于真实交易。


## 统一 Spot 下单环境配置（开发中）

统一下单路由为 `/api/binance/spot-order`。环境由服务端 `BINANCE_SPOT_ENVIRONMENT` 决定，浏览器 `NEXT_PUBLIC_BINANCE_SPOT_TESTNET` 只用于选择行情域名和界面开关；两者配置不一致时，服务端独立开关仍会阻止未授权订单。

测试网模拟配置：

```dotenv
BINANCE_SPOT_ENVIRONMENT=testnet
NEXT_PUBLIC_BINANCE_SPOT_TESTNET=1
BINANCE_TESTNET_API_KEY=模拟测试网Key
BINANCE_TESTNET_API_SECRET=模拟测试网Secret
BINANCE_TESTNET_BUY_ENABLED=0
BINANCE_TESTNET_SELL_ENABLED=0
NEXT_PUBLIC_BINANCE_TESTNET_BUY_ENABLED=0
NEXT_PUBLIC_BINANCE_TESTNET_SELL_ENABLED=0
```

生产配置模板（当前默认禁止提交订单，不能直接照抄启用）：

```dotenv
BINANCE_SPOT_ENVIRONMENT=production
NEXT_PUBLIC_BINANCE_SPOT_TESTNET=0
BINANCE_API_KEY=
BINANCE_API_SECRET=
BINANCE_PRODUCTION_BUY_ENABLED=0
BINANCE_PRODUCTION_SELL_ENABLED=0
NEXT_PUBLIC_BINANCE_PRODUCTION_BUY_ENABLED=0
NEXT_PUBLIC_BINANCE_PRODUCTION_SELL_ENABLED=0
```

`NEXT_PUBLIC_*` 仅是浏览器界面层开关，不含密钥，也不构成服务端授权。真实 Key/Secret 只能放在服务器本地环境文件或 Cloudflare Secrets。生产开关在完成全链路测试和用户明确启用前必须保持为 `0`。
