import { fetchSpotAssetBalance } from "../binance.browser";
import { listTradeLedger } from "./store.browser";
import { assertPositionMatchesExchange, buildPositionReconciliationReport, replayPositionLedger, type PositionLedgerSnapshot, type PositionReconciliationReport } from "./position-accounting";

/**
 * Rebuild one asset's local position from exchange-confirmed ledger fills.
 * This is not an exchange balance snapshot: callers must still reconcile
 * Binance free/locked balances before using it for an execution preflight.
 */
export async function getReconciledPositionFromLedger(
  symbolOrPair: string,
  quoteAsset = "USDT",
): Promise<PositionLedgerSnapshot & { symbol: string; pair: string; fillCount: number }> {
  if (!symbolOrPair || !/^[A-Z0-9]{2,20}$/.test(symbolOrPair)) {
    throw new Error("持仓查询币种格式无效");
  }
  const pair = symbolOrPair.endsWith(quoteAsset) ? symbolOrPair : symbolOrPair + quoteAsset;
  const baseAsset = pair.slice(0, pair.length - quoteAsset.length);
  if (!baseAsset || baseAsset === pair) throw new Error("无法从交易对识别基础资产");

  const all = await listTradeLedger();
  const fills = all.filter((fill) => fill.symbol === pair);
  const position = replayPositionLedger(fills, quoteAsset);
  return { symbol: baseAsset, pair, fillCount: fills.length, ...position };
}


/**
 * Build the final read-only position snapshot for a sell preflight.
 * Any external transfer/manual trade/unsynced fill mismatch blocks the result.
 */
export async function getSellPositionSnapshotFromBinance(
  symbolOrPair: string,
  quoteAsset = "USDT",
): Promise<PositionLedgerSnapshot & {
  symbol: string;
  pair: string;
  fillCount: number;
  freeBaseQty: number;
  totalPositionQty: number;
  protectedBaseQty: number;
}> {
  const position = await getReconciledPositionFromLedger(symbolOrPair, quoteAsset);
  const balance = await fetchSpotAssetBalance(position.symbol);
  const exchangePosition = assertPositionMatchesExchange(position, {
    freeQty: balance.free,
    lockedQty: balance.locked,
    totalQty: balance.total,
  });
  return { ...position, ...exchangePosition };
}


/**
 * Read-only diagnostic for the local ledger versus Binance. Unlike the
 * sell snapshot, this returns a classified mismatch instead of hiding the
 * useful quantities behind an exception. It never repairs either source.
 */
export async function getPositionReconciliationReportFromBinance(
  symbolOrPair: string,
  quoteAsset = "USDT",
): Promise<PositionReconciliationReport & { symbol: string; pair: string; fillCount: number }> {
  const position = await getReconciledPositionFromLedger(symbolOrPair, quoteAsset);
  const balance = await fetchSpotAssetBalance(position.symbol);
  const report = buildPositionReconciliationReport(position, {
    freeQty: balance.free,
    lockedQty: balance.locked,
    totalQty: balance.total,
  });
  return { ...report, symbol: position.symbol, pair: position.pair, fillCount: position.fillCount };
}
