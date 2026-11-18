# 第八阶段：签名成交邮件接收端

## 目标

把“Binance 已确认成交 → IndexedDB Outbox”与邮件发送服务建立安全协议，但不在浏览器中保存任何邮件服务密钥或 Binance 密钥。

## 本阶段提交

- `workers/trade-fill-email.js`：独立的买卖成交通知 Worker。
- `wrangler.trade-fill-email.jsonc`：独立 Worker 配置与 KV binding。
- `workers/TRADE_FILL_EMAIL_SETUP.md`：部署说明、安全边界与幂等限制。
- `lib/execution/notification-signature.server.ts`：服务端 HMAC-SHA256 签名 helper。
- `lib/execution/notification-signature.server.test.ts`：签名 helper 测试。

## 接收协议

请求头：
- `X-Trade-Timestamp`：Unix 毫秒时间戳。
- `X-Trade-Signature`：HMAC-SHA256 十六进制签名。

签名原文：
```text
<timestamp>.<raw-request-body>
```

请求体：
```json
{
  "events": [
    {
      "id": "trade-fill:BTCUSDT:123456",
      "type": "confirmed_trade_fill",
      "side": "BUY",
      "symbol": "BTCUSDT",
      "fillId": "123456",
      "exchangeOrderId": "987654",
      "filledQty": 0.001,
      "fillPrice": 65000,
      "quoteQty": 65,
      "commission": 0.000001,
      "commissionAsset": "BTC",
      "commissionUsdt": 0.065,
      "filledAt": 1795000000000
    }
  ]
}
```

Worker 验证签名、时间窗口和字段后，过滤 KV 已发送事件，发送邮件，再写入 KV。客户端不能传收件人，也不能通过策略信号字段触发邮件。

## 仍然关闭的部分

- Worker 尚未部署。
- 尚未创建/绑定 KV、Resend Secret 或邮件收件人配置。
- 浏览器 Outbox 尚未接入 dispatcher。
- 同源服务端转发 API 尚未创建，因为当前项目没有可确认的身份验证机制；不能开放匿名转发接口。
- SELL 成交仍没有完整的 Binance 对账与统一台账写入流程。
- 没有 Binance 下单 POST，也没有自动卖出；实盘继续关闭。

## 下一阶段前置条件

1. 先确认看板的身份验证方式：优先 Cloudflare Access，或项目已有的可靠登录态。
2. 服务端路由验证身份后才可读取/接收 Outbox 事件；禁止仅凭 Origin、CORS 或公开 URL 授权。
3. 由服务端签名并转发至 Worker；浏览器不得持有 HMAC Secret。
4. 成功确认后才将 Outbox 事件标记 sent；失败保留 pending/failed 并可重试。
5. 如果要求强并发幂等，使用 Durable Object 原子 claim，而不是把 KV 描述为强一致锁。
