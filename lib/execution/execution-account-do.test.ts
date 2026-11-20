import { describe, expect, it } from "vitest";
import { ExecutionAccountDO } from "./execution-account-do";

class FakeSql {
  readonly statements: string[] = [];
  readonly intents = new Map<string, { intent_id: string; state: string; strategy_event_id: string }>();

  exec(query: string, ...bindings: unknown[]) {
    this.statements.push(query);
    let rows: unknown[] = [];
    if (query.includes("INSERT INTO order_intents")) {
      const intentId = String(bindings[0]);
      const eventId = String(bindings[1]);
      if (!this.intents.has(intentId)) {
        this.intents.set(intentId, {
          intent_id: intentId,
          state: "queued",
          strategy_event_id: eventId,
        });
        rows = [{ intent_id: intentId }];
      }
    } else if (query.includes("SELECT intent_id, state, strategy_event_id")) {
      const row = this.intents.get(String(bindings[0]));
      rows = row ? [row] : [];
    } else if (query.includes("SELECT COUNT(*) AS total")) {
      rows = [{ total: this.intents.size }];
    }
    return { toArray: () => rows };
  }
}

function makeCoordinator() {
  const sql = new FakeSql();
  let alarm: number | null = null;
  const state = {
    storage: {
      sql,
      getAlarm: async () => alarm,
      setAlarm: async (value: number) => { alarm = value; },
    },
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>): Promise<T> => callback(),
  };
  return {
    coordinator: new ExecutionAccountDO(state, {}),
    sql,
    getAlarm: () => alarm,
  };
}

const intent = {
  intentId: "v33:BTC:head:2026W47",
  strategyEventId: "BTC:head:2026W47",
  strategyVersion: "3.3",
  symbol: "BTCUSDT",
  side: "BUY",
  quoteAsset: "USDT",
  amount: "100",
  createdAt: 1_800_000_000_000,
};

describe("账户级Durable Object持久化基础", () => {
  it("初始化订单、attempt、资金预留、成交、审计和调度SQLite表", async () => {
    const { coordinator, sql } = makeCoordinator();
    const response = await coordinator.fetch(new Request("https://do.internal/internal/health"));
    const body = await response.json() as { ok: boolean; storage: string; intentCount: number };

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, storage: "sqlite", intentCount: 0 });
    expect(sql.statements.filter((statement) => statement.includes("CREATE TABLE IF NOT EXISTS"))).toHaveLength(7);
  });

  it("拒绝策略版本错误或非正数金额，不写入订单意图", async () => {
    const { coordinator, sql } = makeCoordinator();
    const response = await coordinator.fetch(new Request("https://do.internal/internal/intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...intent, strategyVersion: "3.2" }),
    }));

    expect(response.status).toBe(400);
    expect(sql.intents.size).toBe(0);
  });

  it("同一策略事件重复提交只持久化一条订单意图", async () => {
    const { coordinator, sql } = makeCoordinator();
    const makeRequest = () => new Request("https://do.internal/internal/intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(intent),
    });

    const first = await coordinator.fetch(makeRequest());
    const second = await coordinator.fetch(makeRequest());
    const firstBody = await first.json() as { created: boolean; state: string };
    const secondBody = await second.json() as { created: boolean; state: string };

    expect(first.status).toBe(201);
    expect(firstBody).toEqual({ created: true, state: "queued", accepted: true, intentId: intent.intentId });
    expect(second.status).toBe(200);
    expect(secondBody.created).toBe(false);
    expect(sql.intents.size).toBe(1);
  });

  it("看门狗写入持久化心跳并安排DO Alarm", async () => {
    const { coordinator, sql, getAlarm } = makeCoordinator();
    const response = await coordinator.fetch(new Request("https://do.internal/internal/watchdog", {
      method: "POST",
    }));
    const body = await response.json() as { ok: boolean; watchdogAt: number };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(getAlarm()).toBe(body.watchdogAt + 5 * 60_000);
    expect(sql.statements.some((statement) => statement.includes("last_watchdog_at"))).toBe(true);
  });
});
