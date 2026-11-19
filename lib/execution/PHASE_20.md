# 第二十阶段：Binance 服务端密钥隔离与只读代理

## 已完成

- .env 和 .env.production 已从当前分支删除；新增无密钥 .env.example。
- .gitignore 忽略 .env、.env.*，仅允许跟踪 .env.example。
- Dashboard 不再根据 NEXT_PUBLIC_DIRECT_BINANCE 切换到浏览器直连，数据读取统一走 /api/dashboard。
- lib/binance.ts 只从服务端 process.env 读取凭证。
- 新增 resolveServerBinanceEnvironment：
  - BINANCE_SPOT_ENVIRONMENT=testnet 时固定使用 https://testnet.binance.vision 和 BINANCE_TESTNET_API_KEY/SECRET。
  - 其他模式只使用 BINANCE_API_KEY/SECRET。
  - Testnet 不回退生产凭证，也不接受生产自定义 endpoint。
- 浏览器端 lib/binance.browser.ts 不再读取 NEXT_PUBLIC_* Key/Secret，私密签名 GET 通过同源 /api/binance/signed-read 代理。
- 服务端 signed-read endpoint 采用 endpoint + query 参数 allowlist；只允许只读账户、订单查询、成交查询、交易对信息及 Simple Earn 读取路径。
- Testnet 模式在服务端拒绝所有 Simple Earn SAPI 路径。
- BUY/SELL POST 仍然关闭；没有通过此代理开放任何交易或赎回 POST。
- 增加服务端环境选择与 signed-read allowlist 单元测试。

## 当前未完成

- BUY/SELL 下单 POST 尚未迁移为服务端专用执行 API。
- 队列按钮和自动执行调度尚未接入测试网专用开关。
- 当前不能从 UI 提交测试网订单。
- 尚未运行真实 Spot Testnet 下单、订单查询、逐笔成交、部分成交和超时恢复演练。
- Simple Earn 在 Testnet 不可用，资金调度仍需 Mock 验证。

## 本地配置

复制 .env.example 为 .env.local，密钥只填写在本地文件，不要提交到 GitHub：

- 测试网：BINANCE_SPOT_ENVIRONMENT=testnet，填写 BINANCE_TESTNET_API_KEY/SECRET，并设置非秘密的 NEXT_PUBLIC_BINANCE_SPOT_TESTNET=1。
- 生产：BINANCE_SPOT_ENVIRONMENT=production，填写 BINANCE_API_KEY/SECRET，并移除或设为 NEXT_PUBLIC_BINANCE_SPOT_TESTNET=0。

## 安全边界

- 所有 API Secret 仅存在服务端运行环境。
- 浏览器只知道环境模式，不持有任何 Key/Secret。
- 生产 BUY/SELL 与 Earn redemption 均保持关闭。
- 本阶段没有发送任何交易或赎回 POST。
