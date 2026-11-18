# 第五阶段：USDT 本地资金预留与成交释放

## 本阶段交付

- IndexedDB schema 从 v1 升级到 v2，新增 `buy-funds-reservations`。
- 通过 `planBuyFundsReservation` 从最新 USDT free 中扣除其他活动队列订单的预留金额，再为当前订单分配金额。
- 同一订单预留幂等；多个标签页通过同一 IndexedDB readwrite transaction 串行化，防止在本地重复分配同一笔 USDT。
- 允许部分预留；若可预留余额低于 Binance 最小名义金额则拒绝预留并保留待买订单。
- 通过 `applyConfirmedBuyReservationSpend` 根据累计成交支出计算预留剩余金额，重复轮询相同成交快照不会重复扣减。
- 订单仍处于 NEW / PARTIALLY_FILLED 时保留未成交部分；只有已确认的终态订单才释放剩余预留。
- `syncBuyOrderFromBinance` 在成交明细与订单累计数据一致后，更新对应的本地资金预留。

## 安全边界

本阶段只建立浏览器本地资金预留，不提交订单、不撤单、不自动重试。预留不是 Binance 的真实冻结余额，也不能阻止用户在其他设备或其他应用花费 USDT。真实提交前必须重新读取账户 free 并在受保护的执行端进行最终校验。

IndexedDB 仅在当前浏览器配置中持久化；清理站点数据或更换设备可能丢失预留状态。它不能取代服务端账本或交易所订单核对。

## 后续工作

1. 在 Spot Testnet 验证账户余额变化、订单成交/部分成交/终态释放的完整生命周期。
2. 为跨设备/服务端执行建立持久化资金账本及并发控制。
3. 审查旧 `lib/trading/` 原型与当前 `lib/execution/`，确保只有一套执行存储和执行入口。
4. 完成安全的服务端签名执行边界；届时再通知用户需要启用现货交易权限。当前仍不需要交易权限，实盘保持关闭。
