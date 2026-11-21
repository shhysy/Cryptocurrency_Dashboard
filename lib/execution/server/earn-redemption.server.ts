/**
 * Simple Earn 服务端赎回入口（默认关闭）。
 */

export interface EarnRedeemRequest {
  productId: string;
  amount: string;
  clientRedeemId: string;
}

export interface EarnRedeemResult {
  ok: false;
  error: string;
}

export function isLiveEarnRedemptionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.LIVE_EARN_REDEMPTION_ENABLED === "1";
}

export async function submitEarnRedemptionServer(
  _req: EarnRedeemRequest,
  env: Record<string, string | undefined> = process.env,
): Promise<EarnRedeemResult> {
  if (!isLiveEarnRedemptionEnabled(env)) {
    return { ok: false, error: "Simple Earn 真实赎回默认关闭（LIVE_EARN_REDEMPTION_ENABLED≠1）" };
  }
  if ((env.AUTO_TRADE_MODE ?? "off") === "production" && env.I_UNDERSTAND_LIVE_TRADING !== "yes") {
    return { ok: false, error: "生产赎回需要 I_UNDERSTAND_LIVE_TRADING=yes" };
  }
  return { ok: false, error: "Earn 服务端赎回适配器尚未完成产品核验与签名接入；拒绝提交" };
}
