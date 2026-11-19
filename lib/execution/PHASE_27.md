# Phase 27 — Monotonic BUY reservation reconciliation

## Scope

This phase hardens local USDT reservation accounting when multiple browser tabs reconcile the same BUY order and when a page is closed or refreshed during an in-flight order.

## Changes

- Added `reconcileBuyFundsReservation` as the single pure transition for applying cumulative exchange-confirmed quote spend plus USDT-equivalent commission.
- Rejects cumulative spend snapshots older than the amount already persisted. This prevents an older tab from restoring previously consumed reservation capacity.
- Rejects non-terminal snapshots attempting to reactivate a reservation released after a confirmed terminal order state.
- Keeps a reservation in `active` state while the exchange order is still open, even when its remaining reserved amount reaches zero. A fill alone is not proof of terminal order status.
- Uses the same transition from both atomic fill recording and later cumulative order reconciliation.
- Added tests for cumulative partial spend, out-of-order snapshots, zero remaining reservation on an open order, terminal release, and idempotent terminal refresh.

## Cross-tab and recovery behavior

- `reserveBuyFunds` uses an IndexedDB `readwrite` transaction over the reservation store. Concurrent tabs therefore serialize allocation against the shared local reservation list.
- Repeated reservation attempts for the same order reuse its active reservation rather than allocating it twice.
- `claimBuyOrderSubmission` separately uses an atomic order-store transaction. Only one tab can move a given pending order into `reconcile_required` and claim the attempt; other tabs are rejected.
- Submitted or ambiguous attempts remain persisted as `reconcile_required`. When the dashboard is mounted again, `ExecutionBackground` scans these records immediately and every 30 seconds and resumes read-only Binance reconciliation.
- An ambiguous POST is not automatically resent. Recovery uses the persisted attempt number and deterministic `clientOrderId`.

## Important limitations

- IndexedDB coordination applies only to tabs sharing the same browser origin and browser profile. It is not a server-side or exchange-side balance lock and does not coordinate separate devices or browser profiles.
- Closing a tab preserves IndexedDB state, but reconciliation only resumes after the dashboard is opened again; there is no background service running while the browser is fully closed.
- Clearing browser site data can erase the local queue and reservation records. The exchange remains authoritative; do not infer that a missing local record means an order was never submitted.
- Automated tests validate the pure reservation transition and TypeScript build. They do not constitute a real multi-tab browser test or a real Binance Testnet order test.
- Production order submission and Earn redemption remain disabled.

## Validation

Latest GitHub Actions run for this phase:
- 36 test files passed
- 271 tests passed
- TypeScript typecheck passed
