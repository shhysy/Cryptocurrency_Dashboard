# 卖出信号邮件通知（Cloudflare Worker）

> 本文说明的是策略卖出信号提醒，不是交易所确认成交通知。已确认买卖成交邮件使用独立的 `trade-fill-email.js`，配置见 `TRADE_FILL_EMAIL_SETUP.md`。

本 Worker 只接收看板计算出的卖出信号摘要并发送提醒；不访问 Binance、不计算策略、不下单。看板行情与账户数据由 Next.js 服务端 `/api/dashboard` 提供。

## 数据流

1. 看板通过同源 `/api/dashboard` 获取服务端组装的 DashboardData。
2. 仅当数据来源为 Binance 且非 stale 时，前端把已触发的卖出信号摘要 POST 到本 Worker。
3. Worker 只读取 `signal.action.side === "sell"` 且 `qty > 0` 的信号，用 Resend 发邮件。
4. KV 按币种 + 卖出动作 + 策略标签去重；同一信号持续存在只提醒一次，信号消失后再次触发会重新提醒。

## 重要限制

浏览器直连意味着最新行情由用户浏览器取得。Cloudflare Worker 不可能在网页关闭后代替浏览器访问这份数据。因此本实现只在看板打开并成功刷新数据时检查卖出信号；关闭网页期间不会继续产生新数据或邮件提醒。要实现网页关闭后也监控，必须改为可从 Cloudflare 服务端访问的数据源/行情链路，这与当前浏览器直连架构不同。

## 部署

### 1. 创建 KV

Cloudflare Dashboard → Workers & Pages → KV → Create namespace，名称可用 `SELL_ALERTS`。复制 Namespace ID，替换 `wrangler.sell-email-alert.jsonc` 中的占位 ID。

### 2. 部署 Worker

在项目根目录运行：

```bash
npx wrangler deploy --config wrangler.sell-email-alert.jsonc
```

### 3. 设置 Worker Variables / Secrets

Cloudflare Dashboard → Workers & Pages → cryptocurrency-sell-email-alert → Settings → Variables and Secrets：

| 名称 | 类型 | 内容 |
|---|---|---|
| `ALLOWED_ORIGIN` | Variable | 看板完整 Origin，例如 `https://dashboard.example.com`，不要带路径或末尾斜杠 |
| `MAIL_TO` | Variable | 接收邮箱；多个地址用英文逗号分隔 |
| `MAIL_FROM` | Variable | Resend 已验证域名的发件人，例如 `Signal Alert <alert@yourdomain.com>` |
| `RESEND_API_KEY` | Secret | Resend API Key |

Resend 需先验证发件域名：https://resend.com/domains

### 4. 配置看板构建变量

在 Cloudflare Pages/Workers 的 Next.js 构建环境变量中设置：

```bash
NEXT_PUBLIC_SELL_ALERT_URL=https://你的邮件Worker域名
```

修改后重新构建并部署看板。这个变量是公开的 Worker URL，不是密钥。

## 邮件内容

币种、卖出策略、当前价格、持仓成本、收益率、建议卖出数量、建议卖出比例、预估卖出金额、策略触发原因。

邮件只提醒，不会自动下单。

## 安全与行为

- Worker 的收件人固定来自服务端 `MAIL_TO`，客户端不能指定收件人。
- Worker 只允许配置的看板 Origin 发起浏览器请求；这不是身份认证，公开站点仍应配合看板访问密码，并避免公开分享 Worker URL。
- 只在成功发送邮件后将新信号写入 KV；发送失败不会吞掉提醒，下次刷新会重试。
- 当前策略对历史卖出成交的跟踪仍有限，建议卖出数量沿用看板现有算法，不在本功能中改变。
