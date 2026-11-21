import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendSmtpTextMail: vi.fn(async (_subject: string, _body: string) => undefined),
}));
vi.mock("@/lib/mail-notify", () => mocks);

import { buildTradeFillMailBody, dispatchTradeFillMail, dispatchTraderAlertMail } from "./trade-fill-mail.server";

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

  it("正文包含交易所真实成交数量、金额、手续费、订单ID和成交时间", () => {
    const body = buildTradeFillMailBody([{
      id: "trade-fill:ETHUSDT:1001", fillId: "1001", exchangeOrderId: "2001",
      symbol: "ETHUSDT", side: "SELL", filledQty: 0.25, fillPrice: 3000,
      quoteQty: 750, commission: 0.75, commissionAsset: "USDT",
      commissionUsdt: 0.75, filledAt: 1_800_000_000_000,
    }]);
    expect(body).toContain("ETHUSDT");
    expect(body).toContain("0.25");
    expect(body).toContain("750 USDT");
    expect(body).toContain("0.75 USDT");
    expect(body).toContain("2001");
    expect(body).toContain("1001");
    expect(body).toContain("2027-01-15");
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


describe("Trader熔断告警邮件", () => {
  it("默认关闭且不发送", async () => {
    vi.stubEnv("TRADER_ALERT_MAIL_ENABLED", "0");
    const result = await dispatchTraderAlertMail({
      id: "trader-alert:circuit-breaker:1800000000000",
      severity: "critical",
      title: "Trader连续故障熔断",
      message: "连续失败达到阈值",
      occurredAt: 1_800_000_000_000,
    });
    expect(result).toMatchObject({ ok: true, sent: false });
    expect(mocks.sendSmtpTextMail).not.toHaveBeenCalled();
  });

  it("独立启用后通过SMTP发送熔断告警且正文包含STOP指引", async () => {
    vi.stubEnv("TRADER_ALERT_MAIL_ENABLED", "1");
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_USER", "bot@example.com");
    vi.stubEnv("SMTP_PASS", "test-password");
    vi.stubEnv("MAIL_TO", "owner@example.com");
    const result = await dispatchTraderAlertMail({
      id: "trader-alert:circuit-breaker:1800000000000",
      severity: "critical",
      title: "Trader连续故障熔断",
      message: "连续失败达到阈值",
      occurredAt: 1_800_000_000_000,
    });
    expect(result).toMatchObject({ ok: true, sent: true });
    expect(mocks.sendSmtpTextMail).toHaveBeenCalledWith(
      expect.stringContaining("Trader连续故障熔断"),
      expect.stringContaining("data/STOP"),
    );
  });

  it("SMTP异常返回失败状态供Outbox重试", async () => {
    vi.stubEnv("TRADER_ALERT_MAIL_ENABLED", "1");
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_USER", "bot@example.com");
    vi.stubEnv("SMTP_PASS", "test-password");
    vi.stubEnv("MAIL_TO", "owner@example.com");
    mocks.sendSmtpTextMail.mockRejectedValue(new Error("SMTP暂时不可用"));
    const result = await dispatchTraderAlertMail({
      id: "trader-alert:circuit-breaker:1800000000000",
      severity: "critical",
      title: "Trader连续故障熔断",
      message: "连续失败达到阈值",
      occurredAt: 1_800_000_000_000,
    });
    expect(result).toMatchObject({ ok: false, sent: false });
    expect(result.reason).toContain("SMTP暂时不可用");
  });
});
