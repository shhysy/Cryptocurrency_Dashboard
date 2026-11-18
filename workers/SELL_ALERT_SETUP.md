# 卖出邮件提醒 Worker

这是独立的 Cloudflare Worker，不修改 Next.js 看板的 `/api/dashboard` 接口、币安请求代码或现有策略。

## 工作方式

1. Cloudflare Cron 每 5 分钟触发一次。
2. Worker 请求已部署看板的 `/api/dashboard`，沿用现有数据接口。
3. 只处理 `source === "binance"` 且 `stale === false` 的数据，避免 mock 或过期数据误报。
4. 读取每个币的 `signal.action`。当 `side === "sell"` 且建议数量大于 0 时发送邮件。
5. KV 记录当前已提醒的 `币种 + 动作类型 + 档位`。同一信号持续触发时只发一次；信号解除后再次触发会重新发信。

邮件包含币种、策略档位、当前价、平均成本、收益率、建议卖出数量、占当前持仓比例、预估金额和触发原因。

## 部署

### 1. 创建 KV

在 Cloudflare Dashboard → Workers & Pages → KV 创建命名空间，例如 `SELL_ALERTS`，复制 Namespace ID。

把 `wrangler.sell-alert.jsonc` 中的 `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` 替换为实际 ID。

### 2. 部署独立 Worker

在项目根目录执行：

```bash
npx wrangler deploy --config wrangler.sell-alert.jsonc
```

### 3. 配置 Worker Variables / Secrets

在 Cloudflare Dashboard 打开 `cryptocurrency-sell-email-alert` → Settings → Variables and Secrets，添加：

| 名称 | 类型 | 说明 |
|---|---|---|
| `DASHBOARD_API_URL` | Variable | 完整地址，例如 `https://你的看板域名/api/dashboard` |
| `DASHBOARD_PASSWORD` | Secret（可选） | 如果看板启用了 Basic Auth，填写现有 `DASHBOARD_PASSWORD` |
| `RESEND_API_KEY` | Secret | Resend API Key |
| `MAIL_FROM` | Variable | Resend 已验证域名的发件人，例如 `Crypto Alert <alerts@yourdomain.com>` |
| `MAIL_TO` | Variable | 接收邮箱；多个邮箱用英文逗号分隔 |

Resend 需要先验证发件域名：https://resend.com/domains

### 4. 验证

给 Worker 添加完 Variables / Secrets 和 KV 绑定后，可用 POST 请求手动触发一次检查。正常时返回 `ok: true`。首次触发卖出信号会发邮件；重复触发不会重复发。

也可以在 Cloudflare Worker 的 Triggers 页面查看 Cron 执行记录。

## 注意

- 这是提醒，不会自动交易。
- 邮件中的卖出数量来自现有策略 `signal.action.qty`，不是交易所下单数量。
- 当前看板文档明确说明成本计算只统计买入，且无法识别已卖出的档位。因此若已手动卖出，建议数量可能偏差；这项历史记账问题不在本次邮件 Worker 中擅自改动。
- 看板若使用 Basic Auth，Worker 会用配置的密码访问原接口；不要把密码写入仓库。
- 如果看板部署环境的币安请求返回错误，Worker 不会生成卖出邮件。
