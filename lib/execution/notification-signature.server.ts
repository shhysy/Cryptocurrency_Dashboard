/**
 * Server-only HMAC helper for the trade-fill notification Worker.
 * Never import this module from a client component or expose the secret via NEXT_PUBLIC_*.
 */
export async function signTradeNotificationRequest(
  rawBody: string,
  secret: string,
  timestamp = Date.now(),
): Promise<{ timestamp: string; signature: string }> {
  if (typeof rawBody !== "string" || rawBody.length === 0) {
    throw new Error("成交通知请求体不能为空");
  }
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("TRADE_NOTIFY_HMAC_SECRET 至少需要 32 个字符");
  }
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error("成交通知签名时间戳无效");
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error("当前运行环境不支持 Web Crypto，无法签名成交通知");
  }

  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const timestampText = String(timestamp);
  const payload = new TextEncoder().encode(`${timestampText}.${rawBody}`);
  const digest = await globalThis.crypto.subtle.sign("HMAC", key, payload);
  const signature = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return { timestamp: timestampText, signature };
}
