// 只读：列出现货账户里余额不为 0 的资产（不打印 Key / Secret）。
// 用法: node scripts/check-balance.mjs
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { ProxyAgent, fetch } from "undici";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const dispatcher = env.PROXY_URL ? new ProxyAgent(env.PROXY_URL) : undefined;
const base = env.BINANCE_BASE_URL || "https://api.binance.com";
const get = async (url, headers) => {
  const r = await fetch(url, { headers, dispatcher });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
  return JSON.parse(t);
};

const { serverTime } = await get(`${base}/api/v3/time`);
const qs = `omitZeroBalances=true&recvWindow=10000&timestamp=${serverTime}`;
const sig = createHmac("sha256", env.BINANCE_API_SECRET).update(qs).digest("hex");
const acc = await get(`${base}/api/v3/account?${qs}&signature=${sig}`, { "X-MBX-APIKEY": env.BINANCE_API_KEY });
const prices = Object.fromEntries((await get(`${base}/api/v3/ticker/price`)).map((p) => [p.symbol, Number(p.price)]));

console.log("账户类型:", acc.accountType, "| 权限:", acc.permissions?.join(","));
const rows = acc.balances
  .map((b) => ({ asset: b.asset, free: +b.free, locked: +b.locked }))
  .map((b) => {
    const q = b.free + b.locked;
    const px = ["USDT", "USDC", "FDUSD", "BUSD"].includes(b.asset) ? 1 : prices[b.asset + "USDT"] ?? null;
    return { ...b, total: q, usdt: px === null ? null : q * px };
  })
  .sort((a, b) => (b.usdt ?? -1) - (a.usdt ?? -1));
for (const r of rows) {
  console.log(r.asset.padEnd(8), String(r.total).padEnd(16), r.usdt === null ? "(无 USDT 交易对)" : `≈ ${r.usdt.toFixed(2)} USDT`, r.locked ? `(冻结 ${r.locked})` : "");
}
if (!rows.length) console.log("现货账户没有任何余额。");
