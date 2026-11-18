import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/service";
import { runScoreMailNotify } from "@/lib/mail-notify";

export const dynamic = "force-dynamic";

/**
 * 页面加载后由前端调用：拉最新看板 → 检测分数 → 达标则发邮件。
 * 本机 Node / VPS 可用；Cloudflare Workers 通常无法连 QQ SMTP。
 */
export async function POST() {
  try {
    const data = await getDashboard();
    const result = await runScoreMailNotify(data);
    if (!result.ok) {
      console.error("[notify]", result.error);
      return NextResponse.json(result, { status: 500 });
    }
    if (result.sent) {
      console.log(
        "[notify] mailed",
        result.hits.map((h) => `${h.symbol}=${h.score}`).join(","),
        "->",
        result.to,
      );
    } else {
      console.log("[notify] skip:", result.reason);
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("[notify]", msg);
    return NextResponse.json({ ok: false, error: msg.slice(0, 200) }, { status: 502 });
  }
}

export async function GET() {
  return POST();
}
