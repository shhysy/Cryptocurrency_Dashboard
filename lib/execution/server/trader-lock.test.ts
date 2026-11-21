import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireTraderLock } from "./trader-lock";

const directories: string[] = [];
async function lockPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cryptodash-trader-lock-"));
  directories.push(dir);
  return join(dir, "data", "trader.lock");
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Trader单实例文件锁", () => {
  it("独占创建并拒绝第二个存活进程获取锁，释放后可重新获取", async () => {
    const path = await lockPath();
    const first = await acquireTraderLock({ path, heartbeatMs: 1_000, staleAfterMs: 3_000 });
    try {
      const content = JSON.parse(await readFile(path, "utf8")) as { pid: number; token: string; heartbeatAt: number };
      expect(content.pid).toBe(process.pid);
      expect(content.token).toBe(first.token);
      await expect(acquireTraderLock({ path, heartbeatMs: 1_000, staleAfterMs: 3_000 }))
        .rejects.toThrow("拒绝启动第二个执行进程");
      await first.heartbeat();
      const updated = JSON.parse(await readFile(path, "utf8")) as { token: string };
      expect(updated.token).toBe(first.token);
    } finally {
      await first.release();
    }
    const second = await acquireTraderLock({ path, heartbeatMs: 1_000, staleAfterMs: 3_000 });
    await second.release();
  });

  it("只回收心跳过期且PID不存在的陈旧锁", async () => {
    const path = await lockPath();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(path, ".."), { recursive: true });
    const now = 1_800_000_000_000;
    await writeFile(path, JSON.stringify({
      pid: 2_147_483_647,
      token: "dead-process-token-123456",
      startedAt: now - 10_000,
      heartbeatAt: now - 10_000,
    }));
    const lock = await acquireTraderLock({
      path, heartbeatMs: 1_000, staleAfterMs: 3_000, now: () => now,
    });
    try {
      const payload = JSON.parse(await readFile(path, "utf8")) as { pid: number; token: string };
      expect(payload.pid).toBe(process.pid);
      expect(payload.token).toBe(lock.token);
    } finally {
      await lock.release();
    }
  });
});
