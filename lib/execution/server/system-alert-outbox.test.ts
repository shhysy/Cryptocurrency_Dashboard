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
});
