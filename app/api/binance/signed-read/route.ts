import { NextResponse } from "next/server";
import { fetchSignedBinanceRead } from "@/lib/binance";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8_192;

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

    if (!isSameOriginRequest(req)) {
      return NextResponse.json({ error: "跨站请求已拒绝" }, {
        status: 403, headers: { "Cache-Control": "no-store" },
      });
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return NextResponse.json({ error: "仅接受 JSON 请求" }, { status: 415 });
    }

    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "请求体过大" }, { status: 413 });
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

    if (typeof body.path !== "string" ||
        !body.params || typeof body.params !== "object" ||
        Array.isArray(body.params) ||
        Object.keys(body).some((key) => !["path", "params"].includes(key))) {
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
