import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 旧Testnet浏览器订单接口曾直接提交MARKET订单。
 * 测试网自动交易统一由本地Trader通过LIMIT GTC执行器完成；
 * 此遗留路由永久拒绝下单，避免出现第二条执行路径。
 */
export async function POST() {
  return NextResponse.json(
    { error: "旧Testnet市价下单接口已停用；请使用本地Trader的LIMIT GTC执行器" },
    { status: 410, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } },
  );
}
