import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSystemAlertNotificationEvent } from "../notification-outbox";
import { openLocalExecutionStore } from "./sqlite-store";

const NOW = 1_800_000_000_000;
const directories: string[] = [];

async function openStore() {
  const directory = await mkdtemp(join(tmpdir(), "cryptodash-alert-outbox-"));
  directories.push(directory);
  return openLocalExecutionStore({ path: join(directory, "data", "trader.db") });
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe("Trader系统告警SQLite Outbox", () => {
  it("告警事件持久化且按事件ID幂等", async () => {
    const store = await openStore();
    try {
      const event = buildSystemAlertNotificationEvent({
        id: "trader-alert:circuit-breaker:1800000000000",
        title: "Trader连续故障熔断",
        message: "连续失败达到阈值",
        occurredAt: NOW,
      }, NOW);
      expect(await store.notificationOutbox.enqueueSystemAlert(event)).toEqual({ created: true });
      expect(await store.notificationOutbox.enqueueSystemAlert(event)).toEqual({ created: false });
    } finally {
      store.close();
    }
  });

  it("只领取启用类型的告警，不会误领取成交邮件", async () => {
    const store = await openStore();
    try {
      const event = buildSystemAlertNotificationEvent({
        id: "trader-alert:circuit-breaker:1800000000001",
        title: "Trader连续故障熔断",
        message: "连续失败达到阈值",
        occurredAt: NOW,
      }, NOW);
      await store.notificationOutbox.enqueueSystemAlert(event);

      const fillOnly = await store.notificationOutbox.claimDue({
        now: NOW + 1, leaseMs: 30_000, limit: 10, eventTypes: ["confirmed_trade_fill"],
      });
      expect(fillOnly).toHaveLength(0);

      const alerts = await store.notificationOutbox.claimDue({
        now: NOW + 1, leaseMs: 30_000, limit: 10, eventTypes: ["system_alert"],
      });
      expect(alerts).toHaveLength(1);
      expect(alerts[0].event).toMatchObject({
        id: event.id,
        type: "system_alert",
        severity: "critical",
        title: "Trader连续故障熔断",
      });
      expect(alerts[0].leaseToken).toBeTruthy();
    } finally {
      store.close();
    }
  });

  it("大量更早的成交Outbox不会因类型过滤而饿死熔断告警", async () => {
    const store = await openStore();
    try {
      const db = (store as unknown as { database: { exec(sql: string): void } }).database;
      for (let index = 0; index < 15; index += 1) {
        const id = `trade-fill:BTCUSDT:backlog-${index}`;
        const payload = JSON.stringify({ id, type: "confirmed_trade_fill" });
        db.exec(`INSERT INTO notification_outbox(
          id, payload_json, state, attempt, next_attempt_at, created_at, updated_at
        ) VALUES ('${id}', '${payload}', 'pending', 0, 0, ${NOW - 100 + index}, ${NOW - 100 + index})`);
      }
      const alert = buildSystemAlertNotificationEvent({
        id: "trader-alert:circuit-breaker:1800000000002",
        title: "Trader连续故障熔断",
        message: "连续失败达到阈值",
        occurredAt: NOW,
      }, NOW);
      await store.notificationOutbox.enqueueSystemAlert(alert);
      const alerts = await store.notificationOutbox.claimDue({
        now: NOW + 1, leaseMs: 30_000, limit: 10, eventTypes: ["system_alert"],
      });
      expect(alerts).toHaveLength(1);
      expect(alerts[0].event.id).toBe(alert.id);
    } finally {
      store.close();
    }
  });

  it("损坏的系统告警载荷不会被发送而会转人工复核", async () => {
    const store = await openStore();
    try {
      const db = (store as unknown as { database: { exec(sql: string): void } }).database;
      db.exec(`INSERT INTO notification_outbox(id, payload_json, state, attempt, next_attempt_at, created_at, updated_at)
        VALUES ('trader-alert:broken', '{bad-json', 'pending', 0, 0, ${NOW}, ${NOW})`);
      const claimed = await store.notificationOutbox.claimDue({
        now: NOW + 1, leaseMs: 30_000, limit: 10, eventTypes: ["system_alert"],
      });
      expect(claimed).toHaveLength(0);
      const raw = (store as unknown as { database: { prepare(sql: string): { get(id: string): { state: string } } } })
        .database.prepare("SELECT state FROM notification_outbox WHERE id = ?").get("trader-alert:broken");
      expect(raw.state).toBe("manual_review");
    } finally {
      store.close();
    }
  });
  it("即使BUY意图状态未同步，孤立的manual_review资金预留也必须触发停机计数", async () => {
    const store = await openStore();
    try {
      const db = (store as unknown as { database: { exec(sql: string): void } }).database;
      db.exec(`INSERT INTO order_intents(
        intent_id, strategy_event_id, strategy_version, symbol, side, quote_asset,
        amount, state, attempt, created_at, updated_at
      ) VALUES ('intent-reservation-review', 'event-reservation-review', '3.3', 'BTCUSDT',
        'BUY', 'USDT', '10', 'queued', 1, ${NOW}, ${NOW})`);
      db.exec(`INSERT INTO reservations(
        reservation_id, intent_id, asset, amount, consumed_amount, attempt, state, created_at, updated_at
      ) VALUES ('reservation-review-1', 'intent-reservation-review', 'USDT', '10', '0',
        1, 'manual_review', ${NOW}, ${NOW})`);
      expect(await store.countExecutionManualReview()).toBe(1);
    } finally {
      store.close();
    }
  });

  it("纯通知Outbox人工复核不应被误算成交易订单人工复核", async () => {
    const store = await openStore();
    try {
      const db = (store as unknown as { database: { exec(sql: string): void } }).database;
      db.exec(`INSERT INTO notification_outbox(
        id, payload_json, state, attempt, next_attempt_at, created_at, updated_at
      ) VALUES ('trader-alert:mail-review-only', '{}', 'manual_review', 10, 0, ${NOW}, ${NOW})`);
      expect(await store.countExecutionManualReview()).toBe(0);
    } finally {
      store.close();
    }
  });

  it("统计BUY人工复核与SELL阻断事件，供Trader自动停机", async () => {
    const store = await openStore();
    try {
      const db = (store as unknown as { database: { exec(sql: string): void } }).database;
      db.exec(`INSERT INTO order_intents(
        intent_id, strategy_event_id, strategy_version, symbol, side, quote_asset,
        amount, state, attempt, created_at, updated_at
      ) VALUES ('intent-review-1', 'event-review-1', '3.3', 'BTCUSDT', 'BUY', 'USDT',
        '10', 'manual_review', 1, ${NOW}, ${NOW})`);
      db.exec(`INSERT INTO sell_events(
        event_key, symbol, kind, status, requested_qty, created_at, updated_at
      ) VALUES ('sell-review-1', 'ETH', 'take_profit', 'blocked', 0.1, ${NOW}, ${NOW})`);
      expect(await store.countExecutionManualReview()).toBe(2);
    } finally {
      store.close();
    }
  });

});
