import { NextResponse } from "next/server";
import { fetchSignedBinanceRead } from "@/lib/binance";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8_192;

export async function POST(req: Request) {
  try {
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "请求体过大" }, { status: 413 });
    }
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return NextResponse.json({ error: "仅接受 JSON 请求" }, { status: 415 });
    }
    const body = await req.json() as {
      path?: unknown;
      params?: unknown;
    };
    if (typeof body.path !== "string" ||
        !body.params ||
        typeof body.params !== "object" ||
        Array.isArray(body.params)) {
      return NextResponse.json({ error: "请求参数无效" }, { status: 400 });
    }
    const data = await fetchSignedBinanceRead(
      body.path,
      body.params as Record<string, string | number>,
    );
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store", "Pragma": "no-cache" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Binance signed read failed";
    console.error("[binance-signed-read]", message);
    return NextResponse.json(
      { error: "Binance 只读请求失败", detail: message.slice(0, 160) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
