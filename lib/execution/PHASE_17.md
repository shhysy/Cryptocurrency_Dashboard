# 第十七阶段：成交邮件 Outbox 安全投递

## 本阶段实现

- 扩展成交通知 Outbox 状态：`pending / sending / sent / failed`。
- 新增 2 分钟租约，使用同一 IndexedDB readwrite transaction 批量领取，防止同一浏览器多个标签页重复投递。
- 浏览器崩溃后租约到期可恢复；投递失败按指数退避，最长间隔 1 小时。
- 新增 `notification-dispatch.browser.ts`，只把已核验成交事件的必要字段提交给同源 API。
- 新增 `app/api/trade-fill-notifications/route.ts`：
  - 校验精确 `APP_ORIGIN`
  - 验证 Cloudflare Access JWT 签名、issuer、audience、有效期和可选邮箱白名单
  - 校验成交事件字段和批次幂等 ID
  - 使用仅存在于服务端环境变量的 HMAC Secret 签名
  - 将请求转发到成交邮件 Worker
- `ExecutionBackground` 在页面打开且标签页可见时，每 30 秒运行买卖只读对账及 Outbox 投递。
- Worker 只有确认接收整个批次（accepted + duplicate = batch size）后，浏览器才把事件标记为 sent。

## 需要部署者配置

看板服务端环境变量：
- `APP_ORIGIN`
- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`
- `CF_ACCESS_ALLOWED_EMAIL`（必填，唯一允许邮箱白名单）
- `TRADE_FILL_NOTIFY_URL`
- `TRADE_NOTIFY_HMAC_SECRET`

Cloudflare Worker：
- KV namespace `TRADE_FILL_NOTIFICATIONS`
- Secret `TRADE_NOTIFY_HMAC_SECRET`（必须与看板服务端相同）
- Secret `RESEND_API_KEY`
- Variables `MAIL_FROM`、`MAIL_TO`

部署步骤见 `workers/TRADE_FILL_EMAIL_SETUP.md`。

## 安全边界

- 所有环境变量都不使用 `NEXT_PUBLIC_` 前缀。
- HMAC Secret 和 Resend API Key 不进入浏览器 bundle。
- API 未配置 Access、Origin 或 HMAC 时 fail-closed。
- 浏览器 Outbox 只能来自本地成交核验流程，但本机用户仍能修改浏览器状态；邮件是私人提醒，不是独立审计证明。
- Cloudflare KV 为最终一致性存储；Worker 的 Resend Idempotency-Key 和本地租约降低重复投递风险，但不承诺跨设备严格 exactly-once。
- 页面关闭时不会运行自动 dispatcher；重新打开页面后恢复。
- 邮件投递不需要 Binance TRADE 权限，也不执行任何交易。
