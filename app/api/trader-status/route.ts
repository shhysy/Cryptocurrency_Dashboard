import { NextResponse } from "next/server";
import { readTraderStatusSnapshot } from "@/lib/execution/server/trader-status.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isLoopbackHost(host: string): boolean {
  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" ||
      hostname === "[::1]" || hostname === "::1";
  } catch {
    return false;
  }
}

export function isLocalTraderStatusRequest(req: Request): boolean {
  if (process.env.TRADER_STATUS_API_ENABLED !== "1") return false;
  // 不允许经由公网反向代理转发；本机Next服务还必须绑定loopback接口。
  if (req.headers.has("forwarded") || req.headers.has("x-forwarded-for") ||
      req.headers.has("x-forwarded-host")) return false;
  const host = req.headers.get("host");
  if (!host || !isLoopbackHost(host)) return false;
  try {
    const requestHost = new URL(req.url).hostname.toLowerCase();
    if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(requestHost)) return false;
    const origin = req.headers.get("origin");
    if (origin) {
      const originUrl = new URL(origin);
      if (!isLoopbackHost(originUrl.host) || originUrl.hostname.toLowerCase() !== requestHost) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  if (!isLocalTraderStatusRequest(req)) {
    return NextResponse.json({ error: "本地Trader状态接口未启用或拒绝非本机访问" }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  try {
    const snapshot = await readTraderStatusSnapshot();
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return NextResponse.json({ error: "读取本地Trader状态失败" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
