# 第十三阶段：持仓差异诊断报告（只读）

## 目标

当本地已确认成交台账与 Binance 现货余额不一致时，向用户展示明确的差异方向和数量，而不是只返回一个笼统异常；同时保持自动卖出 fail-closed。

## 已完成

- 新增 `buildPositionReconciliationReport`，分类：
  - `matched`：本地台账与交易所总持仓在容差内一致。
  - `exchange_higher`：交易所持仓高于本地台账，可能是外部转入、漏同步成交或其他账户操作。
  - `ledger_higher`：本地台账高于交易所持仓，可能是转出、手动卖出或未同步账户变化。
  - `exchange_components_invalid`：Binance free + locked 与 total 自身不一致。
- 报告包含 ledger、free、locked、total、delta、tolerance、canSell 和解释文本。
- 新增 `getPositionReconciliationReportFromBinance`，整合本地成交回放和 Binance 只读余额。
- 新增测试覆盖四种状态。

## 安全边界

- 不自动把余额差额当作买入、卖出或转账。
- 不自动调整成本、底仓、周期仓或成交台账。
- 诊断报告不是卖出授权；卖出预检继续使用原有严格核对函数。
- 只有数量匹配时报告才返回 `canSell=true`，但这仍不代表交易已获授权或真实下单已启用。
- 仍无 Binance 下单 POST；实盘保持关闭。
