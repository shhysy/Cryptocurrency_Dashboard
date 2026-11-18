import { strategyConfig } from "@/strategy.config";
import { listTradeLedger } from "./store.browser";
import { replayPositionLedger, type PositionLedgerSnapshot } from "./position-accounting";

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

  const group = strategyConfig.coreSymbols.includes(baseAsset) ? "core" : "alt";
  const baseRatio = strategyConfig.profiles[group].baseRatio;
  const all = await listTradeLedger();
  const fills = all.filter((fill) => fill.symbol === pair);
  const position = replayPositionLedger(fills, baseRatio, quoteAsset);
  return { symbol: baseAsset, pair, fillCount: fills.length, ...position };
}
