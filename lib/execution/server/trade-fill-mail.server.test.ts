import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendSmtpTextMail: vi.fn(async (_subject: string, _body: string) => undefined),
}));
vi.mock("@/lib/mail-notify", () => mocks);

import { buildTradeFillMailBody, dispatchTradeFillMail } from "./trade-fill-mail.server";

afterEach(() => {
  vi.unstubAllEnvs();
  mocks.sendSmtpTextMail.mockReset();
  mocks.sendSmtpTextMail.mockResolvedValue(undefined);
});

describe("成交通知邮件", () => {
  it("默认不发送", async () => {
    vi.stubEnv("TRADE_FILL_MAIL_ENABLED", "0");
    const result = await dispatchTradeFillMail([{ id: "1", symbol: "BTC", side: "BUY", filledQty: 1, fillPrice: 2 }]);
    expect(result.sent).toBe(false);
    expect(mocks.sendSmtpTextMail).not.toHaveBeenCalled();
  });

  it("正文包含币种", () => {
    expect(buildTradeFillMailBody([{ id: "1", symbol: "ETH", side: "SELL" }])).toContain("ETH");
  });

  it("显式启用并配置SMTP后真实调用SMTP发送适配器", async () => {
    vi.stubEnv("TRADE_FILL_MAIL_ENABLED", "1");
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_USER", "bot@example.com");
    vi.stubEnv("SMTP_PASS", "test-password");
    vi.stubEnv("MAIL_TO", "owner@example.com");
    const result = await dispatchTradeFillMail([{
      id: "trade-fill:BTCUSDT:1",
      symbol: "BTCUSDT",
      side: "SELL",
      filledQty: 0.1,
      fillPrice: 60000,
    }]);
    expect(result).toMatchObject({ ok: true, sent: true });
    expect(mocks.sendSmtpTextMail).toHaveBeenCalledTimes(1);
    expect(mocks.sendSmtpTextMail.mock.calls[0]?.[0]).toContain("成交确认");
  });

  it("SMTP异常返回sent=false供Outbox退避重试", async () => {
    vi.stubEnv("TRADE_FILL_MAIL_ENABLED", "1");
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_USER", "bot@example.com");
    vi.stubEnv("SMTP_PASS", "test-password");
    vi.stubEnv("MAIL_TO", "owner@example.com");
    mocks.sendSmtpTextMail.mockRejectedValue(new Error("SMTP暂时不可用"));
    const result = await dispatchTradeFillMail([{ id: "1", symbol: "ETH", side: "BUY" }]);
    expect(result.ok).toBe(false);
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("SMTP暂时不可用");
  });
});
