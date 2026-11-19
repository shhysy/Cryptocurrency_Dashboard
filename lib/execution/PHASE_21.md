# 第二十一阶段：Spot Testnet BUY / SELL 服务端提交

## 已完成

- 新增 POST /api/binance/testnet-order。
- 服务端只接受 BUY / SELL、symbol、amount、clientOrderId 四个字段；拒绝额外字段。
- 强制同源 Origin、JSON content-type、请求体大小限制。
- 要求设置 DASHBOARD_PASSWORD；未配置时订单接口 fail closed。
- 服务端固定 Testnet endpoint，只读取 BINANCE_TESTNET_API_KEY/SECRET。
- 服务端分别检查 BINANCE_TESTNET_BUY_ENABLED / BINANCE_TESTNET_SELL_ENABLED。
- 浏览器只允许通过同源 API 请求订单；不再自行 HMAC 签名或接触 Secret。
- 前端分别使用 NEXT_PUBLIC_BINANCE_TESTNET_BUY_ENABLED / SELL_ENABLED 展示测试网按钮。
- 买入/卖出队列执行器和后台自动调度接入测试网开关。
- 生产环境服务端执行器硬拒绝，前端生产环境开关也始终为 false。
- 新增纯函数测试，验证服务端 BUY/SELL 开关隔离。

## 本地启用顺序

1. 复制 .env.example 为 .env.local。
2. 设置 BINANCE_SPOT_ENVIRONMENT=testnet 与 NEXT_PUBLIC_BINANCE_SPOT_TESTNET=1。
3. 填写独立 Testnet Key/Secret。
4. 设置 DASHBOARD_PASSWORD。
5. 先只开启 BUY 的前后端两个开关；完成买入与对账验证后，再考虑单独开启 SELL。
6. 不要把 .env.local 提交到 GitHub。

## 尚未完成

- 尚未使用用户本地 Testnet Key 发出真实 Testnet 订单。
- 尚未完成真实部分成交、超时、网络中断后的 clientOrderId 恢复演练。
- 尚未验证不同 Testnet 交易对的精度、最小名义金额和流动性差异。
- Simple Earn 不支持 Spot Testnet，相关资金调度继续使用 Mock。
- 需要在本地运行 build 和完整测试；GitHub Actions 结果以本阶段提交对应的最新 run 为准。

## 资金与权限边界

- 这里只能路由到 Binance Spot Testnet，不会调用生产订单 endpoint。
- 没有增加提现、划转、合约或 Earn 赎回接口。
- 生产 BUY/SELL 与 Earn 赎回仍关闭。
- 真实账户资金不参与本阶段。
