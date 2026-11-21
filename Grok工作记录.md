# Grok工作记录

> **请 Claude 一次性验收。** 分支：`gpt`。

## 验证

- `npm test`：72 files / 503 tests 通过  
- `npm run typecheck`：通过  

## 已交付清单

| 编号 | 内容 |
|------|------|
| M0-01 | 删除纯 DO 实现与测试 |
| M0-02 | SELL 01A 台账先按键收集 |
| M0-03 | 规则矩阵核对备注 |
| M0-04 | 文档本地优先 |
| M1-01 | 双连接竞争 claim 测试 |
| M1-02/03 | Trader 常驻 + unknown 只读恢复（既有 + 本轮加固） |
| M1-04 | SQLite SELL 入队 + `scripts/trader.ts` 每轮调用 |
| M1-05 | 看板只读说明 |
| M3-01/02/03 | 模式、自检、熔断 STOP |
| M3-04 | Earn 服务端门控默认关 |
| M3-05 | 成交通知邮件门控默认不发 |
| M3-06 | 日志脱敏 |
| M3-07 | 运维手册 |

## 依赖用户条件（非代码可单独闭环）

- **M2 Testnet 订单号报告**：需用户 Testnet Key 与授权实跑  
- **生产放行**：`AUTO_TRADE_MODE=production` 仍代码拒绝，待验收通过后再开  
- **SMTP 真发成交邮件**：需配置 SMTP 并显式开开关  

## 安全

生产 BUY/SELL、Earn、成交通知默认关闭；Trader 生产模式拒绝启动。
