import { describe, expect, it } from "vitest";
import { submitEarnRedemptionServer } from "./earn-redemption.server";

describe("Earn 服务端赎回", () => {
  it("默认关闭并拒绝", async () => {
    const result = await submitEarnRedemptionServer(
      { productId: "x", amount: "1", clientRedeemId: "r1" },
      { LIVE_EARN_REDEMPTION_ENABLED: "0" },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/默认关闭/);
  });
});
