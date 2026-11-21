import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface TraderLockPayload {
  pid: number;
  token: string;
  startedAt: number;
  heartbeatAt: number;
}

export interface TraderLockOptions {
  path?: string;
  heartbeatMs?: number;
  staleAfterMs?: number;
  now?: () => number;
}

export interface TraderLock {
  readonly path: string;
  readonly token: string;
  heartbeat(): Promise<void>;
  release(): Promise<void>;
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== "ESRCH";
  }
}

function parseLock(raw: string): TraderLockPayload | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (!Number.isSafeInteger(row.pid) || Number(row.pid) <= 0 ||
        typeof row.token !== "string" || row.token.length < 16 ||
        !Number.isSafeInteger(row.startedAt) || !Number.isSafeInteger(row.heartbeatAt)) {
      return null;
    }
    return {
      pid: Number(row.pid),
      token: row.token,
      startedAt: Number(row.startedAt),
      heartbeatAt: Number(row.heartbeatAt),
    };
  } catch {
    return null;
  }
}

/**
 * 文件独占创建提供原子单实例保证；心跳只用于识别进程退出后的陈旧锁。
 * 只有PID已不存在且心跳超过staleAfterMs时才允许回收，不能仅因心跳延迟就抢锁。
 */
export async function acquireTraderLock(options: TraderLockOptions = {}): Promise<TraderLock> {
  const path = resolve(options.path ?? "data/trader.lock");
  const heartbeatMs = options.heartbeatMs ?? 10_000;
  const staleAfterMs = options.staleAfterMs ?? 45_000;
  const now = options.now ?? Date.now;
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 1_000 ||
      !Number.isSafeInteger(staleAfterMs) || staleAfterMs < heartbeatMs * 2) {
    throw new Error("Trader锁心跳配置无效");
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  let acquired = false;
  let token = "";
  let startedAt = now();
  for (let attempt = 0; attempt < 4 && !acquired; attempt += 1) {
    token = randomUUID();
    startedAt = now();
    const payload: TraderLockPayload = {
      pid: process.pid,
      token,
      startedAt,
      heartbeatAt: startedAt,
    };
    try {
      const handle = await import("node:fs/promises").then(({ open }) => open(path, "wx", 0o600));
      try {
        await handle.writeFile(JSON.stringify(payload));
        await handle.sync();
      } finally {
        await handle.close();
      }
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    let existing: TraderLockPayload | null = null;
    let modifiedAt = 0;
    try {
      existing = parseLock(await readFile(path, "utf8"));
      modifiedAt = (await stat(path)).mtimeMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const heartbeatAt = existing?.heartbeatAt ?? modifiedAt;
    const stale = now() - heartbeatAt > staleAfterMs;
    if (!stale || (existing && processIsAlive(existing.pid))) {
      throw new Error(
        existing
          ? `Trader已由PID ${existing.pid}运行；拒绝启动第二个执行进程`
          : "Trader锁文件无效或心跳尚未过期；拒绝覆盖，需人工检查 data/trader.lock",
      );
    }

    const stalePath = `${path}.stale-${randomUUID()}`;
    try {
      await rename(path, stalePath);
      await unlink(stalePath).catch(() => undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (!acquired) throw new Error("无法安全获取Trader单实例锁，请检查data/trader.lock");

  let released = false;
  let heartbeatRunning = false;
  const heartbeat = async () => {
    if (released || heartbeatRunning) return;
    heartbeatRunning = true;
    try {
      const current = parseLock(await readFile(path, "utf8"));
      if (!current || current.token !== token || current.pid !== process.pid) {
        throw new Error("Trader单实例锁已丢失；为避免重复下单，必须停止执行");
      }
      const updated: TraderLockPayload = { ...current, heartbeatAt: now() };
      await writeFile(path, JSON.stringify(updated), { mode: 0o600 });
      await chmod(path, 0o600);
    } finally {
      heartbeatRunning = false;
    }
  };

  const timer = setInterval(() => {
    void heartbeat().catch((error) => {
      process.stderr.write(`[Trader锁] 心跳失败，必须停止：${error instanceof Error ? error.message : "未知错误"}\n`);
      process.kill(process.pid, "SIGTERM");
    });
  }, heartbeatMs);
  timer.unref();

  return {
    path,
    token,
    heartbeat,
    async release() {
      if (released) return;
      released = true;
      clearInterval(timer);
      try {
        const current = parseLock(await readFile(path, "utf8"));
        if (current?.token === token && current.pid === process.pid) {
          await unlink(path);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}
