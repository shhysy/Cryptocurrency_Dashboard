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

**第 2–3 步现已实现，但默认不会发送任何邮件，且必须先完成 Cloudflare Access 配置。** 浏览器 Outbox dispatcher 通过同源 `/api/trade-fill-notifications` 提交；该 API 检查精确 Origin、验证 Cloudflare Access JWT 的签名/issuer/audience/有效期，并可限制唯一允许邮箱，再由服务端 HMAC 签名转发到 Worker。HMAC Secret、Resend Key 和收件人都不进入浏览器。若 Access 或环境变量未配置，接口 fail-closed，Outbox 事件保留并按指数退避重试。

HMAC 只能证明请求来自持有服务端密钥的一方，不能独立证明成交本身真实。Outbox 事件是在浏览器完成 Binance 只读订单/逐笔成交核对后生成，但浏览器运行环境和 IndexedDB 仍可被本机用户修改。因此邮件是私人记账提醒，不是独立审计证明，也不能用来授权交易。真正的资金安全仍由 Binance 交易前预检、订单幂等与持仓核对保障。

## 应用服务端配置

在部署看板的服务端环境变量中配置以下项目（不要使用 `NEXT_PUBLIC_` 前缀）：

| 变量 | 说明 |
|---|---|
| `APP_ORIGIN` | 看板完整 Origin，例如 `https://dashboard.example.com` |
| `CF_ACCESS_TEAM_DOMAIN` | Cloudflare Access Team Domain，例如 `https://myteam.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | Cloudflare Access 应用的 Audience Tag |
| `CF_ACCESS_ALLOWED_EMAIL` | 唯一允许登录的邮箱，**必填**；API 未配置时拒绝投递 |
| `TRADE_FILL_NOTIFY_URL` | 已部署成交邮件 Worker 的 HTTPS URL |
| `TRADE_NOTIFY_HMAC_SECRET` | 与 Worker 相同的随机 HMAC Secret，至少 32 字符 |

同时在 Cloudflare Zero Trust 中为看板域名/路径配置 Access 应用，只允许自己的邮箱登录。API 会在服务端再次验证 `Cf-Access-Jwt-Assertion`，不把 Origin 当作身份认证。

## Outbox 投递

- `ExecutionBackground` 在看板打开且标签页可见时，每 30 秒核对订单并尝试投递 Outbox。
- Outbox 在 IndexedDB readwrite transaction 中领取 2 分钟租约，防止同一浏览器多个标签页重复投递；崩溃后租约过期可恢复。
- 失败事件使用指数退避，最长间隔 1 小时；成功响应（包括 Worker 已识别的重复事件）后才标记 sent。
- 页面关闭期间不会运行 dispatcher；重新打开看板后继续处理未发送事件。

## KV 幂等说明

KV 用于长期去重（默认保留 365 天），但 Cloudflare KV 是最终一致性存储，不提供跨请求原子 compare-and-set。极端并发的同一事件可能同时通过“先查后写”检查。Resend Idempotency-Key 可降低同批请求重复发送，但不能替代强一致锁。正式开启自动投递前，如果要求严格的并发 exactly-once，应改用 Durable Object 做事件级原子 claim；邮件系统本身也无法提供绝对 exactly-once 的投递保证。

## 部署准备（暂不需要执行）

1. 创建 Cloudflare KV namespace，并把 ID 写入 `wrangler.trade-fill-email.jsonc`。
2. 设置 Worker Secret：`TRADE_NOTIFY_HMAC_SECRET`（至少 32 个随机字符）、`RESEND_API_KEY`。
3. 设置 Worker Variables：`MAIL_FROM`、`MAIL_TO`。
4. 运行 `npx wrangler deploy --config wrangler.trade-fill-email.jsonc`。

部署/邮件密钥不是 Binance API Key，不需要 Binance 交易权限。当前不要部署或启用真实通知投递，待服务端身份验证和 Outbox dispatcher 完成后再联调。

## 当前状态

- 服务端 Access JWT 验证、Origin 检查、HMAC 转发 API、浏览器 Outbox 租约和 dispatcher 已写入仓库。
- 需要你在部署环境设置上表中的 Access/Worker 环境变量，并部署成交邮件 Worker；当前没有你的 Access 域名、Audience Tag 或邮件服务凭据，因此不能代你完成部署或验证收件。
- 本功能不会要求 Binance 交易权限；邮件发送和 Binance 下单权限完全分离。
