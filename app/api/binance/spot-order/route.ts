import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 旧浏览器订单接口曾直接提交MARKET订单。
 * 自动交易现统一由本地Trader通过LIMIT GTC执行器完成；
 * 此兼容路由永久拒绝下单，避免绕过0.5%限价与成交对账规则。
 */
export async function POST() {
  return NextResponse.json(
    { error: "旧市价下单接口已停用；请使用本地Trader的LIMIT GTC执行器" },
    { status: 410, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } },
  );
}
