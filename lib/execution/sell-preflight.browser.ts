import type { MarketRules } from "./binance-preflight";
import type { SellEventRecord } from "./sell-store.browser";
import { prepareQueuedSellDryRun, type SellDryRunResult } from "./sell-order.browser";
import { getSellPositionSnapshotFromBinance } from "./position-accounting.browser";

/**
 * Final read-only sell preflight using both the confirmed local trade ledger
 * and the current Binance free/locked balance. A quantity mismatch throws
 * before any sell plan can be returned.
 */
export async function prepareQueuedSellDryRunFromBinance(input: {
  event: SellEventRecord;
  rules: MarketRules;
  currentPrice: number;
}): Promise<SellDryRunResult> {
  const position = await getSellPositionSnapshotFromBinance(
    input.rules.baseAsset,
    input.rules.quoteAsset,
  );
  return prepareQueuedSellDryRun({
    event: input.event,
    rules: input.rules,
    currentPrice: input.currentPrice,
    position: {
      freeBaseQty: position.freeBaseQty,
      totalPositionQty: position.totalPositionQty,
      protectedBaseQty: position.protectedBaseQty,
    },
  });
}
