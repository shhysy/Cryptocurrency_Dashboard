import { describe, expect, it } from "vitest";
import { signTradeNotificationRequest } from "./notification-signature.server";

describe("signTradeNotificationRequest", () => {
  it("creates a stable SHA-256 HMAC for the same body, secret and timestamp", async () => {
    const first = await signTradeNotificationRequest('{"events":[]}', "x".repeat(40), 1_800_000_000_000);
    const second = await signTradeNotificationRequest('{"events":[]}', "x".repeat(40), 1_800_000_000_000);
    expect(first).toEqual(second);
    expect(first.timestamp).toBe("1800000000000");
    expect(first.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes the signature when the body changes", async () => {
    const first = await signTradeNotificationRequest('{"events":[1]}', "x".repeat(40), 1_800_000_000_000);
    const second = await signTradeNotificationRequest('{"events":[2]}', "x".repeat(40), 1_800_000_000_000);
    expect(first.signature).not.toBe(second.signature);
  });

  it("rejects missing bodies, short secrets and invalid timestamps", async () => {
    await expect(signTradeNotificationRequest("", "x".repeat(40))).rejects.toThrow("请求体不能为空");
    await expect(signTradeNotificationRequest("{}", "short")).rejects.toThrow("至少需要 32 个字符");
    await expect(signTradeNotificationRequest("{}", "x".repeat(40), 0)).rejects.toThrow("时间戳无效");
  });
});

describe("成交通知签名安全边界", () => {
  it("相同密钥下不同时间戳产生不同签名", async () => {
    const a = await signTradeNotificationRequest('{"events":[]}', "x".repeat(40), 1_800_000_000_000);
    const b = await signTradeNotificationRequest('{"events":[]}', "x".repeat(40), 1_800_000_000_001);
    expect(a.signature).not.toBe(b.signature);
  });

  it("拒绝负数与非安全整数时间戳", async () => {
    await expect(signTradeNotificationRequest("{}", "x".repeat(40), -1)).rejects.toThrow(/时间戳/);
    await expect(signTradeNotificationRequest("{}", "x".repeat(40), Number.NaN)).rejects.toThrow(/时间戳/);
  });
});
