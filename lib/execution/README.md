# 执行层基础模块（开发阶段）

当前版本只实现本地订单状态、待买队列、部分金额规划、成交台账持久化接口和 CSV 导出，**不包含真实下单调用**。

## 数据约定

- 报价资产固定为 USDT；只使用 Binance 现货账户的 USDT free 余额。
- 固定额度：BTC/PAXG 每币 1,000 USDT，其余币种每币 500 USDT。卖出不会释放累计买入额度。
- 待买订单主存储为 IndexedDB；CSV 文件名为 `待买入订单.csv`，仅用于导出和备份。
- 每笔策略动作使用稳定 `eventKey` 生成 ID；同一事件重复刷新不会再次创建订单。
- 成交台账使用 `symbol:fillId` 唯一键，重复同步同一成交不会重复记账。
- 真实成交确认之前不得减少待买金额或发出“买入完成”邮件。

## 部分买入示例

计划 100 USDT、当前可用 USDT 50、单币额度剩余 1,000、交易所最小名义金额 5：
本轮执行计划为 50 USDT，剩余 50 USDT 留在队列。若可用余额只有 3 USDT，则本轮不提交订单，整笔 100 USDT 继续等待。

## 下一阶段接入点

1. Binance 读取 USDT free 余额（不使用 locked，也不折算其他资产）。
2. Binance exchangeInfo 读取交易对状态、LOT_SIZE、MARKET_LOT_SIZE、MIN_NOTIONAL / NOTIONAL。
3. 用 `newClientOrderId` 建立客户端幂等键；下单超时先查单，不直接重试。
4. 用 `myTrades` / 订单查询确认实际成交，随后调用 `recordConfirmedFill`。
5. 卖出使用独立事件幂等键、周期仓/底仓拆分与卖出成交台账。
6. 只有成交回报核实后才请求邮件 Worker 发送买入/卖出成交通知。

IndexedDB 是浏览器本地持久化，清理浏览器数据或换设备不会自动同步；CSV 需要定期导出备份。多设备之间目前不共享队列。
