# 第十九阶段：Binance Spot Testnet 环境隔离

## 本阶段完成

- 新增 `lib/binance-environment.ts`，集中解析 Spot API 环境。
- 默认生产环境使用 `https://api.binance.com` 和原生产凭证入口。
- 只有显式设置 `NEXT_PUBLIC_BINANCE_SPOT_TESTNET=1` 才切换到 `https://testnet.binance.vision`。
- Testnet 模式只读取 `NEXT_PUBLIC_BINANCE_TESTNET_API_KEY` / `NEXT_PUBLIC_BINANCE_TESTNET_API_SECRET`，绝不回退生产 Key、Secret 或源码 fallback。
- Spot 账户、交易对过滤器、订单查询、逐笔成交和 Spot 公共行情随 BASE 切换到 Testnet。
- Testnet 模式对 Simple Earn 持仓、历史和赎回路径 fail-closed；不会请求生产 `/sapi/v1/simple-earn/*`。
- 新增纯函数测试覆盖环境选择、凭证隔离、生产提交开关保持关闭、Simple Earn Testnet 拒绝。
- README 增加独立 Testnet 环境配置步骤。

## 尚未完成

- Testnet 的 BUY/SELL 提交 UI 与自动执行调度尚未接入 Testnet 专用开关；队列按钮仍按生产实盘开关禁用。
- 当前不能把本阶段描述为完成了 Testnet 真实下单演练。
- 还没有用户自己的 Testnet API Key，也没有运行真实 Testnet 下单、撤单/终态、部分成交和超时恢复演练。
- Simple Earn 不在 Spot Testnet 的支持范围内，仍需用模拟数据验证资金调度，不可拿生产账户测试。

## 安全边界

- `LIVE_SPOT_ORDER_SUBMISSION_ENABLED=false`
- `LIVE_SPOT_SELL_SUBMISSION_ENABLED=false`
- `LIVE_EARN_REDEMPTION_ENABLED=false`
- 生产环境提交开关不会被 Testnet 环境变量打开。
- Testnet Key/Secret 与生产凭证严格分离；缺少 Testnet 凭证时不会使用生产凭证兜底。
- 真实账户资金和现有只读 API Key 未被使用；本阶段未发送任何交易或赎回 POST。

## Testnet 环境变量

```dotenv
NEXT_PUBLIC_DIRECT_BINANCE=1
NEXT_PUBLIC_BINANCE_SPOT_TESTNET=1
NEXT_PUBLIC_BINANCE_TESTNET_API_KEY=your_testnet_key
NEXT_PUBLIC_BINANCE_TESTNET_API_SECRET=your_testnet_secret
```
