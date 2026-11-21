import { describe, expect, it } from "vitest";
import { ExecutionAccountDO } from "./execution-account-do";

class FakeSql {
  readonly statements: string[] = [];
  readonly intents = new Map<string, {
    intent_id: string; state: string; strategy_event_id: string;
    symbol: string; side: string; amount: string; attempt: number; client_order_id?: string;
    exchange_order_id?: string; exchange_terminal_at?: number; fills_reconciled_at?: number;
  }>();
  lock: {
    intent_id: string; attempt: number; lease_token: string; lease_until: number;
    asset: string; reserved_amount: string;
  } | null = null;
  readonly attempts = new Map<string, {
    intent_id: string; attempt: number; client_order_id: string; lease_token: string;
    state: string; exchange_order_id?: string;
  }>();
  readonly reservations = new Map<string, {
    intent_id: string; asset: string; amount: string; attempt: number;
    state: string; consumed_amount: string;
  }>();
  readonly fills = new Map<string, {
    symbol: string; trade_id: string; intent_id: string; attempt: number; order_id: string;
    qty: string; quote_qty: string; commission: string; commission_asset: string; filled_at: number;
  }>();

  exec(query: string, ...bindings: unknown[]) {
    this.statements.push(query);
    let rows: unknown[] = [];
    if (query.includes("SELECT task_id, attempt FROM scheduler_tasks")) {
      rows = [
        { task_id: "reconcile:retry", attempt: 1 },
        { task_id: "reconcile:manual", attempt: 8 },
      ];
    } else if (query.includes("INSERT INTO order_intents")) {
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
    } else if (query.includes("SELECT intent_id, state, symbol, side, attempt, client_order_id FROM order_intents")) {
      const row = this.intents.get(String(bindings[0]));
      rows = row ? [row] : [];
    } else if (query.includes("SELECT intent_id, state, strategy_event_id")) {
      const row = this.intents.get(String(bindings[0]));
      rows = row ? [row] : [];
    } else if (query.includes("SELECT intent_id, symbol, side, amount, state, attempt")) {
      const row = this.intents.get(String(bindings[0]));
      rows = row ? [row] : [];
    } else if (query.startsWith("SELECT") && query.includes("FROM account_lock WHERE singleton = 1")) {
      rows = this.lock ? [this.lock] : [];
    } else if (query.includes("SELECT symbol, side, amount, state, attempt, client_order_id FROM order_intents")) {
      const row = this.intents.get(String(bindings[0]));
      rows = row ? [row] : [];
    } else if (query.includes("SELECT client_order_id, lease_token FROM order_attempts")) {
      const row = this.attempts.get(`${String(bindings[0])}:${Number(bindings[1])}`);
      rows = row ? [row] : [];
    } else if (query.includes("SELECT asset, amount, state FROM reservations")) {
      const row = [...this.reservations.values()].find((item) =>
        item.intent_id === String(bindings[0]) && item.attempt === Number(bindings[1]));
      rows = row ? [row] : [];
    } else if (query.includes("SELECT intent_id, attempt, order_id, qty, quote_qty, commission, commission_asset, filled_at FROM fills")) {
      const row = this.fills.get(`${String(bindings[0])}:${String(bindings[1])}`);
      rows = row ? [row] : [];
    } else if (query.includes("SELECT COUNT(*) AS total FROM fills")) {
      rows = [{
        total: [...this.fills.values()].filter((item) =>
          item.intent_id === String(bindings[0]) &&
          item.attempt === Number(bindings[1]) &&
          item.order_id === String(bindings[2])).length,
      }];
    } else if (query.includes("SELECT state, client_order_id, attempt FROM order_intents")) {
      const row = this.intents.get(String(bindings[0]));
      rows = row ? [row] : [];
    } else if (query.includes("UPDATE order_intents")) {
      if (query.includes("SET state = 'reserved'")) {
        const row = this.intents.get(String(bindings[3]));
        if (row?.state === "queued") {
          row.state = "reserved";
          row.attempt = Number(bindings[0]);
          row.client_order_id = String(bindings[1]);
          rows = [{ intent_id: row.intent_id }];
        }
      } else if (query.includes("SET state = 'submitting'")) {
        const row = this.intents.get(String(bindings[1]));
        if (row?.state === "reserved" && row.attempt === Number(bindings[2])) {
          row.state = "submitting";
          rows = [{ intent_id: row.intent_id }];
        }
      } else if (query.includes("SET state = 'unknown'")) {
        const row = this.intents.get(String(bindings[2]));
        if (row && row.attempt === Number(bindings[3]) &&
            (row.state === "submitting" || row.state === "reconciling")) {
          row.state = "unknown";
          rows = [{ intent_id: row.intent_id }];
        }
      } else if (query.includes("SET state = 'reconciling'")) {
        const row = this.intents.get(String(bindings[1]));
        if (row && row.attempt === Number(bindings[2]) &&
            ["submitting", "unknown", "reconciling"].includes(row.state)) {
          row.state = "reconciling";
          rows = [{ intent_id: row.intent_id }];
        }
      } else if (query.includes("SET state = ?")) {
        const row = this.intents.get(String(bindings[5]));
        if (row && row.attempt === Number(bindings[6]) &&
            ["submitting", "unknown", "reconciling"].includes(row.state)) {
          row.state = String(bindings[0]);
          row.exchange_order_id = String(bindings[1]);
          row.exchange_terminal_at = Number(bindings[2]);
          row.fills_reconciled_at = Number(bindings[3]);
          rows = [{ intent_id: row.intent_id }];
        }
      }
    } else if (query.includes("UPDATE order_attempts")) {
      if (query.includes("SET state = ?")) {
        const row = this.attempts.get(`${String(bindings[3])}:${Number(bindings[4])}`);
        if (row && row.lease_token === String(bindings[5])) {
          row.state = String(bindings[0]);
          row.exchange_order_id = String(bindings[1]);
          rows = [{ attempt_id: `${row.intent_id}:${row.attempt}` }];
        }
      } else if (query.includes("SET lease_token = ?")) {
        const row = this.attempts.get(`${String(bindings[2])}:${Number(bindings[3])}`);
        if (row && row.lease_token === String(bindings[4])) {
          row.lease_token = String(bindings[0]);
          row.state = "reconciling";
          rows = [{ attempt_id: `${row.intent_id}:${row.attempt}` }];
        }
      } else {
        const row = this.attempts.get(`${String(bindings[1])}:${Number(bindings[2])}`);
        if (row && row.lease_token === String(bindings[3])) {
          row.state = query.includes("SET state = 'submitting'") ? "submitting" : "unknown";
          rows = [{ attempt_id: `${row.intent_id}:${row.attempt}` }];
        }
      }
    } else if (query.includes("UPDATE account_lock")) {
      if (query.includes("SET lease_until = ?")) {
        if (this.lock && this.lock.intent_id === String(bindings[2]) &&
            this.lock.attempt === Number(bindings[3]) &&
            this.lock.lease_token === String(bindings[4]) &&
            this.lock.lease_until > Number(bindings[5])) {
          this.lock.lease_until = Number(bindings[0]);
          rows = [{ intent_id: this.lock.intent_id }];
        }
      } else if (this.lock && this.lock.intent_id === String(bindings[3]) &&
          this.lock.attempt === Number(bindings[4]) &&
          this.lock.lease_token === String(bindings[5]) &&
          this.lock.lease_until <= Number(bindings[6])) {
        this.lock.lease_token = String(bindings[0]);
        this.lock.lease_until = Number(bindings[1]);
        rows = [{ intent_id: this.lock.intent_id }];
      }
    } else if (query.includes("UPDATE reservations")) {
      const row = [...this.reservations.values()].find((item) =>
        item.intent_id === String(bindings[2]) && item.attempt === Number(bindings[3]) && item.state === "reserved");
      if (row) {
        row.consumed_amount = String(bindings[0]);
        row.state = "settled";
        rows = [{ reservation_id: `${row.intent_id}:${row.attempt}` }];
      }
    } else if (query.includes("DELETE FROM account_lock")) {
      if (this.lock && this.lock.intent_id === String(bindings[0]) &&
          this.lock.attempt === Number(bindings[1]) && this.lock.lease_token === String(bindings[2])) {
        const deleted = this.lock;
        this.lock = null;
        rows = [{ intent_id: deleted.intent_id }];
      }
    } else if (query.includes("INSERT INTO fills")) {
      const key = `${String(bindings[0])}:${String(bindings[1])}`;
      if (!this.fills.has(key)) {
        this.fills.set(key, {
          symbol: String(bindings[0]), trade_id: String(bindings[1]),
          intent_id: String(bindings[2]), attempt: Number(bindings[3]),
          order_id: String(bindings[4]), qty: String(bindings[5]),
          quote_qty: String(bindings[6]), commission: String(bindings[7]),
          commission_asset: String(bindings[8]), filled_at: Number(bindings[9]),
        });
        rows = [{ trade_id: String(bindings[1]) }];
      }
    } else if (query.includes("INSERT INTO reservations")) {
      this.reservations.set(String(bindings[0]), {
        intent_id: String(bindings[1]),
        asset: String(bindings[2]),
        amount: String(bindings[3]),
        attempt: Number(bindings[4]),
        state: "reserved",
        consumed_amount: "0",
      });
    } else if (query.includes("INSERT INTO order_attempts")) {
      this.attempts.set(`${String(bindings[1])}:${Number(bindings[2])}`, {
        intent_id: String(bindings[1]),
        attempt: Number(bindings[2]),
        client_order_id: String(bindings[3]),
        lease_token: String(bindings[4]),
        state: String(bindings[5]),
      });
    } else if (query.includes("INSERT INTO account_lock")) {
      this.lock = {
        intent_id: String(bindings[0]),
        attempt: Number(bindings[1]),
        lease_token: String(bindings[2]),
        lease_until: Number(bindings[3]),
        asset: String(bindings[4]),
        reserved_amount: String(bindings[5]),
      };
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

  it("调度任务表包含持久化租约、退避与人工复核字段", async () => {
    const { coordinator, sql } = makeCoordinator();
    await coordinator.fetch(new Request("https://do.internal/internal/health"));

    const schedulerSchema = sql.statements.find((statement) =>
      statement.includes("CREATE TABLE IF NOT EXISTS scheduler_tasks"));
    expect(schedulerSchema).toContain("lease_token TEXT");
    expect(schedulerSchema).toContain("lease_until INTEGER");
    expect(schedulerSchema).toContain("next_attempt_at INTEGER NOT NULL");
    expect(schedulerSchema).toContain("last_error TEXT");
    expect(sql.statements).toContain("PRAGMA table_info(scheduler_tasks)");
    expect(sql.statements.some((statement) =>
      statement.includes("CREATE INDEX IF NOT EXISTS idx_scheduler_tasks_due"))).toBe(true);
  });

  it("Alarm恢复过期调度租约并计算下一次持久化唤醒", async () => {
    const { coordinator, sql } = makeCoordinator();
    await coordinator.alarm();

    expect(sql.statements.some((statement) =>
      statement.includes("SELECT task_id, attempt FROM scheduler_tasks") &&
      statement.includes("lease_until <= ?"))).toBe(true);
    expect(sql.statements.some((statement) =>
      statement.includes("SET state = 'pending'") &&
      statement.includes("next_attempt_at = ?"))).toBe(true);
    expect(sql.statements.some((statement) =>
      statement.includes("SET state = 'manual_review'"))).toBe(true);
    expect(sql.statements.some((statement) =>
      statement.includes("SELECT MIN(CASE"))).toBe(true);
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
      state: "reserved", consumed_amount: "0",
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

  it("有效租约可续期，但过期租约不能复活", async () => {
    const { coordinator, sql } = makeCoordinator();
    await coordinator.fetch(new Request("https://do.internal/internal/intents", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(intent),
    }));
    const claimedResponse = await coordinator.fetch(new Request("https://do.internal/internal/claim", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, asset: "USDT", availableBalance: "100", snapshotAt: Date.now() }),
    }));
    const claimed = await claimedResponse.json() as { attempt: number; leaseToken: string };
    const originalLeaseUntil = sql.lock?.lease_until ?? 0;

    const renewed = await coordinator.fetch(new Request("https://do.internal/internal/renew-lease", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, attempt: claimed.attempt, leaseToken: claimed.leaseToken }),
    }));
    const renewedBody = await renewed.json() as { renewed: boolean; leaseUntil: number };
    expect(renewed.status).toBe(200);
    expect(renewedBody.renewed).toBe(true);
    expect(renewedBody.leaseUntil).toBeGreaterThanOrEqual(originalLeaseUntil);

    if (!sql.lock) throw new Error("测试未创建账户锁");
    sql.lock.lease_until = Date.now() - 1;
    const expiredRenewal = await coordinator.fetch(new Request("https://do.internal/internal/renew-lease", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, attempt: claimed.attempt, leaseToken: claimed.leaseToken }),
    }));
    expect(expiredRenewal.status).toBe(409);
    expect(sql.lock.lease_until).toBeLessThan(Date.now());
  });

  it("提交前必须持有当前leaseToken并先持久化submitting", async () => {
    const { coordinator, sql } = makeCoordinator();
    await coordinator.fetch(new Request("https://do.internal/internal/intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(intent),
    }));
    const claimResponse = await coordinator.fetch(new Request("https://do.internal/internal/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, asset: "USDT", availableBalance: "100", snapshotAt: Date.now() }),
    }));
    const claim = await claimResponse.json() as { attempt: number; leaseToken: string; clientOrderId: string };

    const stale = await coordinator.fetch(new Request("https://do.internal/internal/mark-submitting", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, attempt: claim.attempt, leaseToken: "old-token" }),
    }));
    expect(stale.status).toBe(409);
    expect(sql.intents.get(intent.intentId)?.state).toBe("reserved");

    const submitting = await coordinator.fetch(new Request("https://do.internal/internal/mark-submitting", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, attempt: claim.attempt, leaseToken: claim.leaseToken }),
    }));
    const body = await submitting.json() as { state: string; clientOrderId: string };
    expect(submitting.status).toBe(200);
    expect(body).toEqual({ ok: true, intentId: intent.intentId, attempt: 1, clientOrderId: claim.clientOrderId, state: "submitting" });
    expect(sql.intents.get(intent.intentId)?.state).toBe("submitting");
    expect(sql.attempts.get(`${intent.intentId}:1`)?.state).toBe("submitting");
  });

  it("提交前入队只读对账任务，并可读取原订单身份与账户租约上下文", async () => {
    const { coordinator, sql } = makeCoordinator();
    await coordinator.fetch(new Request("https://do.internal/internal/intents", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(intent),
    }));
    const claimResponse = await coordinator.fetch(new Request("https://do.internal/internal/claim", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, asset: "USDT", availableBalance: "100", snapshotAt: Date.now() }),
    }));
    const claim = await claimResponse.json() as { attempt: number; leaseToken: string; clientOrderId: string };
    await coordinator.fetch(new Request("https://do.internal/internal/mark-submitting", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, attempt: claim.attempt, leaseToken: claim.leaseToken }),
    }));

    const context = await coordinator.fetch(new Request(
      `https://do.internal/internal/reconcile-context?intentId=${encodeURIComponent(intent.intentId)}`,
    ));
    const body = await context.json() as Record<string, unknown>;
    expect(context.status).toBe(200);
    expect(body).toMatchObject({
      intentId: intent.intentId, state: "submitting", symbol: "BTCUSDT", side: "BUY",
      attempt: 1, clientOrderId: claim.clientOrderId, leaseToken: claim.leaseToken, terminal: false,
    });
    expect(sql.statements.some((statement) =>
      statement.includes("INSERT INTO scheduler_tasks") && statement.includes("reconcile_intent"))).toBe(true);
  });

  it("提交结果未知时保留账户锁，不允许释放或创建新订单", async () => {
    const { coordinator, sql } = makeCoordinator();
    await coordinator.fetch(new Request("https://do.internal/internal/intents", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(intent),
    }));
    const claimedResponse = await coordinator.fetch(new Request("https://do.internal/internal/claim", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, asset: "USDT", availableBalance: "100", snapshotAt: Date.now() }),
    }));
    const claimed = await claimedResponse.json() as { attempt: number; leaseToken: string };
    await coordinator.fetch(new Request("https://do.internal/internal/mark-submitting", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, attempt: claimed.attempt, leaseToken: claimed.leaseToken }),
    }));
    const unknown = await coordinator.fetch(new Request("https://do.internal/internal/mark-unknown", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, attempt: claimed.attempt, leaseToken: claimed.leaseToken, reason: "模拟POST超时" }),
    }));

    expect(unknown.status).toBe(200);
    expect(sql.intents.get(intent.intentId)?.state).toBe("unknown");
    expect(sql.lock?.intent_id).toBe(intent.intentId);
  });

  it("过期租约只能接管对账，旧token被fencing且attempt不变", async () => {
    const { coordinator, sql } = makeCoordinator();
    await coordinator.fetch(new Request("https://do.internal/internal/intents", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(intent),
    }));
    const claimedResponse = await coordinator.fetch(new Request("https://do.internal/internal/claim", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, asset: "USDT", availableBalance: "100", snapshotAt: Date.now() }),
    }));
    const claimed = await claimedResponse.json() as { attempt: number; leaseToken: string; clientOrderId: string };
    await coordinator.fetch(new Request("https://do.internal/internal/mark-submitting", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, attempt: claimed.attempt, leaseToken: claimed.leaseToken }),
    }));
    if (!sql.lock) throw new Error("测试未创建账户锁");
    sql.lock.lease_until = Date.now() - 1;

    const takeover = await coordinator.fetch(new Request("https://do.internal/internal/takeover", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, attempt: claimed.attempt, leaseToken: claimed.leaseToken }),
    }));
    const taken = await takeover.json() as {
      reconcileOnly: boolean; attempt: number; leaseToken: string; clientOrderId: string;
    };
    expect(takeover.status).toBe(200);
    expect(taken.reconcileOnly).toBe(true);
    expect(taken.attempt).toBe(claimed.attempt);
    expect(taken.clientOrderId).toBe(claimed.clientOrderId);
    expect(taken.leaseToken).not.toBe(claimed.leaseToken);
    expect(sql.intents.get(intent.intentId)?.state).toBe("reconciling");

    const oldTokenWrite = await coordinator.fetch(new Request("https://do.internal/internal/mark-unknown", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, attempt: claimed.attempt, leaseToken: claimed.leaseToken }),
    }));
    expect(oldTokenWrite.status).toBe(409);
  });

  it("逐笔成交与交易所累计完全一致后才结算预留并释放账户锁", async () => {
    const { coordinator, sql } = makeCoordinator();
    await coordinator.fetch(new Request("https://do.internal/internal/intents", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(intent),
    }));
    const claimedResponse = await coordinator.fetch(new Request("https://do.internal/internal/claim", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, asset: "USDT", availableBalance: "100", snapshotAt: Date.now() }),
    }));
    const claimed = await claimedResponse.json() as { attempt: number; leaseToken: string };
    await coordinator.fetch(new Request("https://do.internal/internal/mark-submitting", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, attempt: claimed.attempt, leaseToken: claimed.leaseToken }),
    }));
    const terminalAt = Date.now();
    const response = await coordinator.fetch(new Request("https://do.internal/internal/finalize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intentId: intent.intentId, attempt: claimed.attempt, leaseToken: claimed.leaseToken,
        exchangeOrderId: "90001", exchangeStatus: "FILLED", executedQty: "0.001",
        cumulativeQuoteQty: "50", exchangeTerminalAt: terminalAt,
        fills: [{
          tradeId: "70001", orderId: "90001", qty: "0.001", quoteQty: "50",
          commission: "0.00001", commissionAsset: "BTC", filledAt: terminalAt,
        }],
      }),
    }));
    const body = await response.json() as { state: string; fillCount: number; consumedAmount: string };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, state: "filled", fillCount: 1, consumedAmount: "50" });
    expect(sql.fills.size).toBe(1);
    expect(sql.reservations.get(`${intent.intentId}:1:USDT`)).toMatchObject({
      state: "settled", consumed_amount: "50",
    });
    expect(sql.intents.get(intent.intentId)?.state).toBe("filled");
    expect(sql.lock).toBeNull();
  });

  it("SELL部分成交将基础资产手续费计入消耗后再释放剩余预留", async () => {
    const { coordinator, sql } = makeCoordinator();
    const sellIntent = {
      ...intent,
      intentId: "v33:BTC:reduce:2026W47",
      strategyEventId: "BTC:reduce:2026W47",
      side: "SELL",
      amount: "0.01",
    };
    await coordinator.fetch(new Request("https://do.internal/internal/intents", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sellIntent),
    }));
    const claimedResponse = await coordinator.fetch(new Request("https://do.internal/internal/claim", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: sellIntent.intentId, asset: "BTC", availableBalance: "0.01", snapshotAt: Date.now() }),
    }));
    const claimed = await claimedResponse.json() as { attempt: number; leaseToken: string };
    await coordinator.fetch(new Request("https://do.internal/internal/mark-submitting", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: sellIntent.intentId, attempt: claimed.attempt, leaseToken: claimed.leaseToken }),
    }));
    const terminalAt = Date.now();
    const response = await coordinator.fetch(new Request("https://do.internal/internal/finalize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intentId: sellIntent.intentId, attempt: claimed.attempt, leaseToken: claimed.leaseToken,
        exchangeOrderId: "90004", exchangeStatus: "CANCELED", executedQty: "0.009",
        cumulativeQuoteQty: "500", exchangeTerminalAt: terminalAt,
        fills: [{
          tradeId: "70004", orderId: "90004", qty: "0.009", quoteQty: "500",
          commission: "0.0001", commissionAsset: "BTC", filledAt: terminalAt,
        }],
      }),
    }));
    const body = await response.json() as { state: string; consumedAmount: string };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, state: "partial_terminal", consumedAmount: "0.0091" });
    expect(sql.reservations.get(`${sellIntent.intentId}:1:BTC`)).toMatchObject({
      state: "settled", consumed_amount: "0.0091",
    });
    expect(sql.lock).toBeNull();
  });

  it("Binance EXPIRED_IN_MATCH零成交终态可安全释放预留", async () => {
    const { coordinator, sql } = makeCoordinator();
    await coordinator.fetch(new Request("https://do.internal/internal/intents", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(intent),
    }));
    const claimedResponse = await coordinator.fetch(new Request("https://do.internal/internal/claim", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, asset: "USDT", availableBalance: "100", snapshotAt: Date.now() }),
    }));
    const claimed = await claimedResponse.json() as { attempt: number; leaseToken: string };
    await coordinator.fetch(new Request("https://do.internal/internal/mark-submitting", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, attempt: claimed.attempt, leaseToken: claimed.leaseToken }),
    }));
    const terminalAt = Date.now();
    const response = await coordinator.fetch(new Request("https://do.internal/internal/finalize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intentId: intent.intentId, attempt: claimed.attempt, leaseToken: claimed.leaseToken,
        exchangeOrderId: "90005", exchangeStatus: "EXPIRED_IN_MATCH", executedQty: "0",
        cumulativeQuoteQty: "0", exchangeTerminalAt: terminalAt, fills: [],
      }),
    }));
    const body = await response.json() as { state: string; consumedAmount: string };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, state: "expired", fillCount: 0, consumedAmount: "0" });
    expect(sql.lock).toBeNull();
    expect(sql.reservations.get(`${intent.intentId}:1:USDT`)).toMatchObject({
      state: "settled", consumed_amount: "0",
    });
  });

  it("逐笔成交与交易所累计数量不一致时拒绝落账和释放资金", async () => {
    const { coordinator, sql } = makeCoordinator();
    await coordinator.fetch(new Request("https://do.internal/internal/intents", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(intent),
    }));
    const claimedResponse = await coordinator.fetch(new Request("https://do.internal/internal/claim", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, asset: "USDT", availableBalance: "100", snapshotAt: Date.now() }),
    }));
    const claimed = await claimedResponse.json() as { attempt: number; leaseToken: string };
    await coordinator.fetch(new Request("https://do.internal/internal/mark-submitting", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, attempt: claimed.attempt, leaseToken: claimed.leaseToken }),
    }));
    const terminalAt = Date.now();
    const response = await coordinator.fetch(new Request("https://do.internal/internal/finalize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intentId: intent.intentId, attempt: claimed.attempt, leaseToken: claimed.leaseToken,
        exchangeOrderId: "90002", exchangeStatus: "FILLED", executedQty: "0.002",
        cumulativeQuoteQty: "50", exchangeTerminalAt: terminalAt,
        fills: [{
          tradeId: "70002", orderId: "90002", qty: "0.001", quoteQty: "50",
          commission: "0", commissionAsset: "BTC", filledAt: terminalAt,
        }],
      }),
    }));

    expect(response.status).toBe(409);
    expect(sql.fills.size).toBe(0);
    expect(sql.lock?.intent_id).toBe(intent.intentId);
    expect(sql.reservations.get(`${intent.intentId}:1:USDT`)?.state).toBe("reserved");
  });

  it("拒绝重复tradeId，且不能因重复成交明细释放预留", async () => {
    const { coordinator, sql } = makeCoordinator();
    await coordinator.fetch(new Request("https://do.internal/internal/intents", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(intent),
    }));
    const claimedResponse = await coordinator.fetch(new Request("https://do.internal/internal/claim", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, asset: "USDT", availableBalance: "100", snapshotAt: Date.now() }),
    }));
    const claimed = await claimedResponse.json() as { attempt: number; leaseToken: string };
    await coordinator.fetch(new Request("https://do.internal/internal/mark-submitting", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.intentId, attempt: claimed.attempt, leaseToken: claimed.leaseToken }),
    }));
    const terminalAt = Date.now();
    const duplicateFill = {
      tradeId: "70003", orderId: "90003", qty: "0.001", quoteQty: "50",
      commission: "0", commissionAsset: "BTC", filledAt: terminalAt,
    };
    const response = await coordinator.fetch(new Request("https://do.internal/internal/finalize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intentId: intent.intentId, attempt: claimed.attempt, leaseToken: claimed.leaseToken,
        exchangeOrderId: "90003", exchangeStatus: "FILLED", executedQty: "0.002",
        cumulativeQuoteQty: "100", exchangeTerminalAt: terminalAt,
        fills: [duplicateFill, duplicateFill],
      }),
    }));

    expect(response.status).toBe(400);
    expect(sql.fills.size).toBe(0);
    expect(sql.lock?.intent_id).toBe(intent.intentId);
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
