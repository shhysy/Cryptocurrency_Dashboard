# 已确认买卖成交邮件 Worker（第八阶段）

这是一个独立的成交通知 Worker。它与 `workers/sell-email-alert.js` 完全分离：旧 Worker 只发送策略卖出信号提醒；本 Worker 只接收成交事件，不接收策略信号，也不连接 Binance、不下单。

## 当前实现范围

- 仅接受 `type=confirmed_trade_fill` 的买入或卖出成交事件。
- 要求服务端 HMAC-SHA256 签名，签名覆盖原始请求体和毫秒时间戳；请求时间窗口为 ±5 分钟。
- 拒绝过期请求、无效签名、未知事件类型、无效交易对/成交 ID/订单 ID、非正成交数量/价格/成交额及重复事件 ID。
- 单批最多 20 笔事件，请求体最多 32 KiB。
- KV 按 `trade-fill:<symbol>:<exchangeTradeId>` 去重，成功发送后才写入 KV；邮件失败不会标记为已发送。
- 邮件收件人只由 Worker Secret/Variable 中的 `MAIL_TO` 决定，客户端不能指定收件人。
- Resend 请求附带稳定的 Idempotency-Key，降低“邮件已被服务商接收但 Worker 未能写入 KV”时的重复发送风险。
- 不包含 Binance API Key、Secret、余额或账户总资产。

## 重要安全边界

**不要从浏览器直接调用本 Worker，也不要把 HMAC Secret 放进 `NEXT_PUBLIC_*` 变量或前端代码。** 浏览器代码可被用户查看，无法保密。

预期的数据流为：

1. 浏览器从 IndexedDB 读取本地 Outbox。
2. 浏览器把待投递事件提交到同源服务端 API。
3. 服务端先验证用户身份/访问权限，再使用仅存在于服务端环境变量中的 `TRADE_NOTIFY_HMAC_SECRET` 签名请求。
4. 服务端将签名请求转发到本 Worker。
5. Worker 验证签名、调用 Resend，并在发送成功后写入 KV。
6. 服务端将成功接收的事件 ID 返回浏览器；浏览器再将对应 Outbox 标记为 sent。

**本阶段尚未实现第 2–3 步。** 当前仓库没有可确认的用户会话/身份验证机制；不能仅凭 CORS、Origin 或公开 URL 保护服务端 API。必须先确定 Cloudflare Access 或应用登录态，并在服务端验证身份后，才可安全开放转发接口。当前 Worker 仅完成服务端到服务端的签名接收端，尚未部署，也未接入前端 Outbox。

HMAC 只能证明请求来自持有服务端密钥的一方，不能独立证明成交本身真实。真实成交事实仍必须由本地 Binance 只读对账链路核验后才可入 Outbox；服务端转发层必须限制为已登录用户，并且不能允许匿名调用者任意伪造事件。

## KV 幂等说明

KV 用于长期去重（默认保留 365 天），但 Cloudflare KV 是最终一致性存储，不提供跨请求原子 compare-and-set。极端并发的同一事件可能同时通过“先查后写”检查。Resend Idempotency-Key 可降低同批请求重复发送，但不能替代强一致锁。正式开启自动投递前，如果要求严格的并发 exactly-once，应改用 Durable Object 做事件级原子 claim；邮件系统本身也无法提供绝对 exactly-once 的投递保证。

## 部署准备（暂不需要执行）

1. 创建 Cloudflare KV namespace，并把 ID 写入 `wrangler.trade-fill-email.jsonc`。
2. 设置 Worker Secret：`TRADE_NOTIFY_HMAC_SECRET`（至少 32 个随机字符）、`RESEND_API_KEY`。
3. 设置 Worker Variables：`MAIL_FROM`、`MAIL_TO`。
4. 运行 `npx wrangler deploy --config wrangler.trade-fill-email.jsonc`。

部署/邮件密钥不是 Binance API Key，不需要 Binance 交易权限。当前不要部署或启用真实通知投递，待服务端身份验证和 Outbox dispatcher 完成后再联调。
