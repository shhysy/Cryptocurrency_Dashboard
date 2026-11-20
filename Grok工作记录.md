# Grok工作记录

> 主开发分支：gpt。策略依据《策略3.3》。遵守文件白名单与项目规则。

## 冲突检查
未改 GPT 的 BUY 预留、strategy.config、Dashboard。本轮新增卖出节拍与文档。

## 本轮完成（面向自动化交易）

### 1. 卖出自动化单次节拍
- 文件：`lib/execution/sell-automation-tick.ts`
- 流程：信号入队 → 对账同步 →（双开关+数据新鲜才尝试）最多一笔 pending 卖出 → 通知 Outbox
- 默认不实盘：`attemptLiveSubmit` 与 `BINANCE_SPOT_SELL_SUBMISSION_ENABLED` 同时为真才提交
- 提交：`6d11f86900f1e13043a04ec5698848ddc14f7a00`

### 2. 自动化落地路径文档
- `docs/策略3.3/自动化交易落地路径.md`
- 明确：框架有 ≠ Testnet 验收有 ≠ 可生产无人值守

### 3. 此前已完成（仍有效）
- 底仓减仓后受保护底仓重算、止盈部分成交 resume（`sell-signal-queue.ts`）

## 自动化系统真实状态（给用户）
- **半自动**：打开看板 + 测试网开关 → 可沿现有 Background 跑
- **全自动无人值守**：还缺 Testnet 全链路实测 + 服务端常驻调度 + 生产授权
- **下一步建议**：Testnet 小额买一笔、卖一笔（止盈），记工作记录；再谈 VPS/Worker 调度

## 验证
```bash
npx vitest run lib/execution/sell-signal-queue.resume.test.ts lib/execution/sell-guard.test.ts
```
（节拍模块依赖浏览器 store，单测可后续补 mock）

## 安全
生产 BUY/SELL 保持关闭；不提交真实密钥。
