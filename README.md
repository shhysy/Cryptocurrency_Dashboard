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
BINANCE_API_KEY=你的生产只读_API_Key
BINANCE_API_SECRET=你的生产只读_API_Secret
```

测试网模式固定使用 `https://testnet.binance.vision`，只读取测试网凭证，不会回退到生产 Key；生产模式只读取生产凭证。测试网不支持 Simple Earn，因此测试网环境会拒绝 Simple Earn 路径。

**当前完成边界：** Dashboard 的账户与行情请求已切换到 Next.js 服务端，浏览器不再需要读取 Binance 密钥；服务端已按环境选择 Spot endpoint 和凭证。测试网买卖提交 API、队列按钮和自动执行调度仍需后续迁移到服务端，当前不会从页面提交任何订单。生产 BUY/SELL 与 Earn 赎回保持关闭。真实测试网下单、部分成交和超时恢复演练尚未完成。

## 安全提醒

- 本地密钥放在 `.env.local`；该文件已被 Git 忽略。GitHub 只提交无密钥的 `.env.example`。
- 已经发到聊天或提交到仓库的密钥应在 Binance 后台撤销并重新生成；删除文件不会让旧密钥失效。
- 测试网与生产凭证完全分离；测试网缺少凭证时不会使用生产凭证兜底。
- 生产交易开关默认关闭；不开放提现、划转或合约权限。
- 部署到公网必须配置 `DASHBOARD_PASSWORD` 并启用 HTTPS。
- `ENABLE_ACCOUNT=0` 时只读取公开行情，不读取账户余额和成交。

## 免责声明

信号仅供参考，不构成投资建议。加密货币波动剧烈，请控制仓位。


### Spot Testnet 下单（仅用于虚拟资产演练）

当前已提供服务端 `/api/binance/testnet-order`，只允许 MARKET BUY / SELL，服务端固定使用 Testnet endpoint 和 Testnet Key。生产模式在服务端硬拒绝。浏览器不会持有 Secret。

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

BUY 和 SELL 可分别开启；首次联调建议只开启 BUY，验证流程后再单独开启 SELL。任何一侧缺少前端或服务端开关都会拒绝请求。生产 BUY/SELL 开关不存在可用的启用路径，仍保持关闭。提交结果不明确时只保留 clientOrderId 并进入对账，不自动重发。

注意：队列买入仍依赖账户余额、交易对规则和本地资金预留；卖出仍依赖本地成交账本与 Binance 持仓核对。不要为了通过测试而绕过这些保护。
