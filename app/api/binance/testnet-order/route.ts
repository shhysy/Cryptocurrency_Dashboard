import { NextResponse } from "next/server";
import { submitTestnetSpotMarketOrder } from "@/lib/binance";

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

export async function POST(req: Request) {
  try {
    const password = process.env.DASHBOARD_PASSWORD;
    if (!password || !hasDashboardAuthentication(req, password)) {
      return NextResponse.json(
        { error: "需要有效的 Dashboard Basic Auth 认证" },
        {
          status: 401,
          headers: {
            "WWW-Authenticate": 'Basic realm="Signal Dashboard", charset="UTF-8"',
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const origin = req.headers.get("origin");
    const requestUrl = new URL(req.url);
    let originMatches = false;
    try {
      originMatches = Boolean(origin) && new URL(origin!).origin === requestUrl.origin;
    } catch {
      originMatches = false;
    }
    if (!originMatches) {
      return NextResponse.json({ error: "跨站请求已拒绝" }, { status: 403 });
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

    const result = await submitTestnetSpotMarketOrder({
      side: body.side,
      symbol: body.symbol,
      amount: body.amount,
      clientOrderId: body.clientOrderId,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store", "Pragma": "no-cache" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Testnet order failed";
    console.error("[binance-testnet-order]", message);
    const status = /仅允许|开关未|缺少|无效|格式/.test(message) ? 403 : 502;
    return NextResponse.json(
      { error: "测试网订单未确认受理", detail: message.slice(0, 200) },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
