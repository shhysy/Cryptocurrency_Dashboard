import { NextResponse } from "next/server";
import { submitSpotMarketOrder } from "@/lib/binance";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2_048;

function safeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function hasDashboardAuthentication(req: Request, expectedPassword: string): boolean {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    return safeEqual(decoded.slice(separator + 1), expectedPassword);
  } catch {
    return false;
  }
}

function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

/** 统一下单入口：只接受已认证同源请求，服务端再次检查环境和方向开关。 */
export async function POST(req: Request) {
  try {
    const password = process.env.DASHBOARD_PASSWORD;
    if (!password || !hasDashboardAuthentication(req, password)) {
      return NextResponse.json({ error: "需要有效的 Dashboard Basic Auth 认证" }, {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Signal Dashboard", charset="UTF-8"',
          "Cache-Control": "no-store",
        },
      });
    }
    if (!isSameOriginRequest(req)) {
      return NextResponse.json({ error: "跨站请求已拒绝" }, {
        status: 403, headers: { "Cache-Control": "no-store" },
      });
    }
    if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
      return NextResponse.json({ error: "仅接受 JSON 请求" }, { status: 415 });
    }
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "请求体过大" }, { status: 413 });
    }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "请求参数无效" }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "JSON 格式无效" }, { status: 400 });
    }
    if ((body.side !== "BUY" && body.side !== "SELL") ||
        typeof body.symbol !== "string" ||
        typeof body.amount !== "string" ||
        typeof body.clientOrderId !== "string" ||
        Object.keys(body).some((key) => !["side", "symbol", "amount", "clientOrderId"].includes(key))) {
      return NextResponse.json({ error: "订单参数无效" }, { status: 400 });
    }
    const result = await submitSpotMarketOrder({
      side: body.side,
      symbol: body.symbol,
      amount: body.amount,
      clientOrderId: body.clientOrderId,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store", "Pragma": "no-cache" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Binance Spot order failed";
    console.error("[binance-spot-order]", message);
    const status = /开关未启用|缺少|无效|格式|仅允许/.test(message) ? 403 : 502;
    return NextResponse.json({ error: "Binance 订单未确认受理", detail: message.slice(0, 200) }, {
      status, headers: { "Cache-Control": "no-store" },
    });
  }
}
