import { describe, expect, it } from "vitest";
import { buildTradeFillMailBody, dispatchTradeFillMail } from "./trade-fill-mail.server";

describe("成交通知邮件", () => {
  it("默认不发送", async () => {
    const r = await dispatchTradeFillMail([{ id: "1", symbol: "BTC", side: "BUY", filledQty: 1, fillPrice: 2 }]);
    expect(r.sent).toBe(false);
  });
  it("正文包含币种", () => {
    expect(buildTradeFillMailBody([{ id: "1", symbol: "ETH", side: "SELL" }])).toContain("ETH");
  });
});
