# Phase 28 — Sequential take-profit and post-TP average-cost rebuy

## User-confirmed rules

- Long-term base inventory is protected; ordinary take-profit operates on cycle inventory.
- TP tiers are sequential and each tier is once-only:
  - 2x current average cost: sell 50% of current cycle inventory.
  - 3x current average cost, only after tier 1 has confirmed fills: sell 30% of then-current cycle inventory.
  - 5x current average cost, only after tier 2 has confirmed fills: sell 80% of then-current cycle inventory.
- A partial terminal fill counts as that tier having executed; actual fills, not requested quantity, are recorded.
- After any confirmed take-profit fill in the current holding round, disable the old head-price add ladder and reserve tier.
- Rebuy from current average cost, beginning again at add tier 1. Core drops remain 15/30/45/60%; conservative drops remain 30/50/65/80%; amounts reuse the corresponding profile add amounts.
- Each rebuy tier is counted once per exchange order. A fully closed position ends the round; the next holding round returns to normal head-order rules.
- Rebuy remains subject to score, stabilization, cooldown, market-state and per-asset cost-cap constraints.

## Implementation

- Updated both profile take-profit arrays to 2x/3x/5x with 50%/30%/80%.
- Changed the strategy engine to calculate each TP fraction from the currently remaining cycle quantity.
- Added `strategy/post-take-profit-rebuy.ts`, which hydrates server-computed signals using confirmed SELL events and the browser's exchange-confirmed execution ledger.
- TP tier state is inferred only from confirmed `take_profit` sell events with recorded fill IDs; pending events do not switch the strategy to post-TP mode.
- TP events are strictly sequential. A price jump directly to 5x cannot skip the 2x and 3x tiers.
- The post-TP rebuy ladder uses the replayed remaining average cost and counts distinct BUY order IDs after the first TP fill, so multiple partial fills of one order do not consume several rebuy tiers.
- Replays BUY costs and SELL quantities from dashboard buys plus local confirmed SELL fills. Base-asset commissions are included in disposed quantity.
- If TP history is present but fill details are missing, or replayed quantity does not match current holdings, rebuy is blocked rather than falling back to the old head-price ladder.
- If the replay reaches zero holdings before a later new buy, the new position is treated as a new round.
- Dashboard strategy queue creation runs after local sell history is loaded and applied.

## Persistence boundary and limitations

- Confirmed sell-kind history and execution fills currently live in browser IndexedDB. They are not synchronized across devices or browser profiles.
- Clearing site data can erase this history. If TP history cannot be reconciled with its fills and current balance, the strategy blocks the post-TP rebuy path.
- External/manual trades that are not represented in the local ledger may cause a quantity mismatch; this is intentionally fail-closed.
- The server-generated signal can be briefly visible before the browser hydrates local IndexedDB on first load; execution queue creation is gated on the fresh dashboard state and then uses the hydrated state.
- No real order was submitted in this phase. Live production trading remains disabled.

## Validation

- 37 test files passed.
- 279 tests passed.
- TypeScript typecheck passed.
- GitHub Actions: https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44473898881
