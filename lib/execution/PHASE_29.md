# Phase 29 — BUY attempt fencing and duplicate-fill integrity

## Changes

### 1. Fence every asynchronous state write by attempt ID

- All error and partial-fill state writes in `sync-buy-order.browser.ts` now pass the attempt number that initiated the reconciliation.
- Successful and ambiguous POST outcomes in `buy-order-submit.browser.ts` also pass the claimed attempt number.
- If an older browser tab finishes late after another tab has reconciled the order or claimed a newer attempt, its state write is rejected by the IndexedDB transaction guard.
- This closes a race where an old partial snapshot or delayed POST callback could put a newer attempt back into `reconcile_required`.

### 2. Verify duplicate BUY fills against persisted facts

- `recordConfirmedBuyFill` now reads the unique fill index and trade ledger in the same readwrite transaction.
- A duplicate fill is accepted only if both the fill index and ledger row exist and every immutable execution field matches.
- A duplicate ID with changed quantity, price, quote amount, commission, asset, side, order ID or timestamp is rejected.
- A fill index without a ledger row, or a ledger row without a fill index, now fails closed.
- Duplicate BUY reconciliation no longer silently trusts the newest response payload.

### 3. Tests

- Added `sync-buy-order.browser.test.ts` to verify:
  - partial orders remain locked;
  - fill-ledger failures carry the originating attempt;
  - reservation-reconciliation failures carry the originating attempt.
- Existing tests cover conflicting duplicate fill payloads and monotonic reservation spend.

## Safety boundary

- Production BUY/SELL switches remain disabled.
- Simple Earn redemption remains disabled.
- No real order was submitted.
- These changes improve local browser-tab concurrency and ledger integrity; IndexedDB is still local to a browser profile and does not lock funds on Binance.
- A timeout or missing order lookup remains in reconciliation/manual review. The system does not blindly resubmit an ambiguous order.

## Validation

- 38 test files passed.
- 284 tests passed.
- TypeScript typecheck passed.
- GitHub Actions: https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44475066618
