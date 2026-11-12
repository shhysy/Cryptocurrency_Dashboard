/**
 * 内存缓存（TTL + 失败回退）。
 * 请求失败时返回上次成功的数据，并标记 stale。
 * 注意：Serverless / Workers 的内存只在单个实例内有效，冷启动后会丢失。
 */
interface Entry<T> {
  value: T;
  at: number;
}

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export interface Cached<T> {
  value: T;
  at: number;
  stale: boolean;
  error?: string;
}

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<Cached<T>> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return { value: hit.value, at: hit.at, stale: false };

  let p = inflight.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  try {
    const value = await p;
    const at = Date.now();
    store.set(key, { value, at });
    return { value, at, stale: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (hit) return { value: hit.value, at: hit.at, stale: true, error: msg };
    throw e;
  }
}
