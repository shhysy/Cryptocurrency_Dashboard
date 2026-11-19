import { NextResponse } from "next/server";
import { submitTestnetSpotMarketOrder } from "@/lib/binance";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2_048;

export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");
    const requestUrl = new URL(req.url);
    if (!origin || new URL(origin).origin !== requestUrl.origin) {
      return NextResponse.json({ error: "跨站请求已拒绝" }, { status: 403 });
    }
    if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
      return NextResponse.json({ error: "仅接受 JSON 请求" }, { status: 415 });
    }
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "请求体过大" }, { status: 413 });
    }
    const body = await req.json() as Record<string, unknown>;
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
