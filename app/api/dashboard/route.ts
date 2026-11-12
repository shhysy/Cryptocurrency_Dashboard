import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const scenario = new URL(req.url).searchParams.get("scenario") ?? undefined;
  try {
    const data = await getDashboard({ scenario });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    // 不把底层错误细节（可能含请求参数）原样返回
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("[dashboard]", msg);
    return NextResponse.json({ error: "数据获取失败，且没有可用缓存", detail: msg.slice(0, 120) }, { status: 502 });
  }
}
