# 第十一阶段：加权平均持仓账本回放

## 目标

从交易所已确认成交记录重建每个资产的长期底仓、周期仓、成本、均价与实现盈亏，为后续卖出预检提供可核验的本地数据来源。

## 已完成

- 新增 position-accounting.ts，按成交时间顺序回放 BUY/SELL，使用加权平均成本法。
- BUY fill 根据 V3.3 底仓比例拆分长期底仓与周期仓。
- 普通止盈、指标止盈、追踪止损只能减少周期仓；底仓减仓只减少长期底仓。
- BUY 基础币手续费：净买入数量扣除手续费，不重复加成本。
- BUY USDT/第三资产手续费：计入成本。
- SELL 基础币手续费：增加被处置数量，不再从 quote proceeds 重复扣手续费。
- SELL USDT/第三资产手续费：从净卖出收入扣除。
- 计算每笔卖出时的平均成本、成本移除额与累计实现盈亏。
- TradeLedgerEntry.sellKind 持久化卖出事件类别；卖出同步传入事件类别。
- 新增 getReconciledPositionFromLedger，读取本地成交台账并重建单币快照。
- 测试覆盖买卖费用、底仓/周期仓边界和异常成交数据。

## 当前计算口径

- BUY 基础币手续费：netQty = qty - commission，cost = quoteQty。
- BUY 报价币/第三资产手续费：netQty = qty，cost = quoteQty + commissionUsdt。
- SELL 基础币手续费：disposedQty = qty + commission，proceeds = quoteQty。
- SELL 报价币/第三资产手续费：disposedQty = qty，proceeds = quoteQty - commissionUsdt。
- 卖出实现盈亏：netProceeds - averageCost × disposedQty。

## 安全限制

- 该模块只回放本地已核验成交，不等于 Binance 当前持仓。
- 手动交易、转入/转出、其他设备交易或遗漏历史成交会造成台账与交易所余额差异。
- 当前底仓比例从 V3.3 配置读取；将来若改变比例，必须保存历史策略参数或做显式迁移。
- 尚未将该快照接入真实卖出预检；卖出前必须重新读取 Binance free/locked 并对账。
- 未确认成交、第三资产手续费未可靠估值或超过仓位的卖出，必须暂停并人工复核。
- 不包含订单提交、撤单、自动重试；实盘保持关闭。
