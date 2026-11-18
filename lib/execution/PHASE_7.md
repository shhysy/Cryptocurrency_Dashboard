# 第七阶段：真实成交邮件 Outbox（本地持久化）

## 本阶段交付

- IndexedDB 执行数据库升级到 v3，新增 `notification-outbox` store。
- 只有经过 Binance 订单与逐笔成交核验、并成功写入买入成交台账的 BUY fill，才会创建邮件事件。
- Outbox 事件与唯一成交 ID 在同一个 IndexedDB readwrite transaction 中写入；重复对账不会重复创建邮件事件。
- 事件 ID 使用 `trade-fill:<symbol>:<exchangeTradeId>`，供邮件 Worker 做幂等去重。
- Outbox 只保存成交必要字段，不保存 API Key、Secret、账户余额或账户总资产。
- 提供读取 outbox、确认发送、记录失败状态的存储接口。
- 新增纯函数校验器和单元测试，校验成交字段并验证稳定事件 ID。

## 安全边界

本阶段不直接发送邮件、不调用 Worker、不产生交易请求。只有交易所成交核验通过后才生成 outbox 事件。策略信号、待买队列和未成交订单不会生成成交邮件。

IndexedDB 是浏览器本地持久化；清除站点数据可能丢失尚未投递的通知。Outbox 入队不等于邮件已发送或送达。

## 尚未完成

1. Worker 接收成交事件的受保护接口与 KV 幂等去重。
2. 浏览器/服务端投递调度、失败重试与重复投递处理。
3. SELL 成交对账与 SELL outbox 事件。
4. 邮件服务接受、发送和最终送达状态的区分。
5. Binance Spot Testnet 买卖完整端到端验证。

当前仍然不需要 Binance 交易权限；本阶段没有下单代码。
