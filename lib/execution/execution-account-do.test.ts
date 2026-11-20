import { describe, expect, it } from "vitest";
import { ExecutionAccountDO } from "./execution-account-do";

class FakeSql {
  readonly statements: string[] = [];
  readonly intents = new Map<string, {
    intent_id: string; state: string; strategy_event_id: string;
    symbol: string; side: string; amount: string; attempt: number; client_order_id?: string;
  }>();
  lock: { intent_id: string } | null = null;
  readonly reservations = new Map<string, { intent_id: string; asset: string; amount: string; attempt: number }>();

  exec(query: string, ...bindings: unknown[]) {
    this.statements.push(query);
    let rows: unknown[] = [];
    if (query.includes("INSERT INTO order_intents")) {
      const intentId = String(bindings[0]);
      const eventId = String(bindings[1]);
      if (!this.intents.has(intentId)) {
        this.intents.set(intentId, {
          intent_id: intentId,
          state: String(bindings[7]),
          strategy_event_id: eventId,
          symbol: String(bindings[3]),
          side: String(bindings[4]),
          amount: String(bindings[6]),
          attempt: Number(bindings[8]),
        });
        rows = [{ intent_id: intentId }];
      }
    } else if (query.includes("SELECT intent_id, state, strategy_event_id")) {
      const row = this.intents.get(String(bindings[0]));
      rows = row ? [row] : [];
    } else if (query.includes("SELECT intent_id, symbol, side, amount, state, attempt")) {
      const row = this.intents.get(String(bindings[0]));
      rows = row ? [row] : [];
    } else if (query.includes("SELECT intent_id FROM account_lock")) {
      rows = this.lock ? [this.lock] : [];
    } else if (query.includes("UPDATE order_intents")) {
      const row = this.intents.get(String(bindings[3]));
      if (row?.state === "queued") {
        row.state = "reserved";
        row.attempt = Number(bindings[0]);
        row.client_order_id = String(bindings[1]);
        rows = [{ intent_id: row.intent_id }];
      }
    } else if (query.includes("INSERT INTO reservations")) {
      this.reservations.set(String(bindings[0]), {
        intent_id: String(bindings[1]),
        asset: String(bindings[2]),
        amount: String(bindings[3]),
        attempt: Number(bindings[4]),
      });
    } else if (query.includes("INSERT INTO account_lock")) {
      this.lock = { intent_id: String(bindings[0]) };
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
      transactionSync: <T>(callback: () => T): T => callback(),
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
    expect(sql.statements.filter((statement) => statement.includes("CREATE TABLE IF NOT EXISTS"))).toHaveLength(8);
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

  it("订单领取在SQLite事务中创建账户锁、attempt与资金预留", async () => {
    const { coordinator, sql } = makeCoordinator();
    await coordinator.fetch(new Request("https://do.internal/internal/intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(intent),
    }));
    const response = await coordinator.fetch(new Request("https://do.internal/internal/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intentId: intent.intentId,
        asset: "USDT",
        availableBalance: "100.00",
        snapshotAt: Date.now(),
      }),
    }));
    const body = await response.json() as {
      accepted: boolean; attempt: number; clientOrderId: string; leaseToken: string;
      reservedAmount: string;
    };

    expect(response.status).toBe(201);
    expect(body.accepted).toBe(true);
    expect(body.attempt).toBe(1);
    expect(body.clientOrderId.length).toBeLessThanOrEqual(36);
    expect(body.leaseToken).toBeTruthy();
    expect(body.reservedAmount).toBe("100");
    expect(sql.intents.get(intent.intentId)?.state).toBe("reserved");
    expect(sql.lock?.intent_id).toBe(intent.intentId);
    expect([...sql.reservations.values()]).toEqual([{
      intent_id: intent.intentId, asset: "USDT", amount: "100", attempt: 1,
    }]);
  });

  it("账户活动订单锁阻止另一币种并发领取", async () => {
    const { coordinator, sql } = makeCoordinator();
    const secondIntent = {
      ...intent,
      intentId: "v33:ETH:head:2026W47",
      strategyEventId: "ETH:head:2026W47",
      symbol: "ETHUSDT",
      amount: "50",
    };
    for (const item of [intent, secondIntent]) {
      await coordinator.fetch(new Request("https://do.internal/internal/intents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(item),
      }));
    }
    const claim = (intentId: string, availableBalance: string) => coordinator.fetch(
      new Request("https://do.internal/internal/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intentId, asset: "USDT", availableBalance, snapshotAt: Date.now() }),
      }),
    );

    const [first, second] = await Promise.all([
      claim(intent.intentId, "100"),
      claim(secondIntent.intentId, "100"),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(sql.lock?.intent_id).toBeTruthy();
    expect(sql.intents.get(secondIntent.intentId)?.state).toBe(
      sql.lock?.intent_id === secondIntent.intentId ? "reserved" : "queued",
    );
  });

  it("使用十进制整数比较余额，不允许微小数量不足被浮点误差吞掉", async () => {
    const { coordinator, sql } = makeCoordinator();
    const tinyIntent = {
      ...intent,
      intentId: "v33:BTC:tiny:2026W47",
      strategyEventId: "BTC:tiny:2026W47",
      amount: "0.000000000002",
    };
    await coordinator.fetch(new Request("https://do.internal/internal/intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(tinyIntent),
    }));
    const response = await coordinator.fetch(new Request("https://do.internal/internal/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intentId: tinyIntent.intentId,
        asset: "USDT",
        availableBalance: "0.000000000001",
        snapshotAt: Date.now(),
      }),
    }));

    expect(response.status).toBe(409);
    expect(sql.intents.get(tinyIntent.intentId)?.state).toBe("queued");
    expect(sql.lock).toBeNull();
  });

  it("余额不足或过期余额快照不得领取和预留资金", async () => {
    const { coordinator, sql } = makeCoordinator();
    await coordinator.fetch(new Request("https://do.internal/internal/intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(intent),
    }));
    const insufficient = await coordinator.fetch(new Request("https://do.internal/internal/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, asset: "USDT", availableBalance: "99.99", snapshotAt: Date.now() }),
    }));
    const stale = await coordinator.fetch(new Request("https://do.internal/internal/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, asset: "USDT", availableBalance: "100", snapshotAt: Date.now() - 61_000 }),
    }));

    expect(insufficient.status).toBe(409);
    expect(stale.status).toBe(400);
    expect(sql.intents.get(intent.intentId)?.state).toBe("queued");
    expect(sql.lock).toBeNull();
  });

  it("看门狗写入持久化心跳并安排DO Alarm", async () => {
    const { coordinator, sql, getAlarm } = makeCoordinator();
    const response = await coordinator.fetch(new Request("https://do.internal/internal/watchdog", {
      method: "POST",
    }));
    const body = await response.json() as { ok: boolean; watchdogAt: number };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    const firstAlarm = getAlarm();
    expect(firstAlarm).toBe(body.watchdogAt + 5 * 60_000);

    await coordinator.fetch(new Request("https://do.internal/internal/watchdog", {
      method: "POST",
    }));
    expect(getAlarm()).toBe(firstAlarm);
    expect(sql.statements.some((statement) => statement.includes("last_watchdog_at"))).toBe(true);
  });
});
