/**
 * Binance newClientOrderId is limited to 36 characters and allows a restricted
 * character set. This deterministic 64-bit non-cryptographic hash is an
 * idempotency key, not a security primitive. The full event key remains in IndexedDB.
 */
export function clientOrderIdForEvent(eventKey: string, attempt = 0): string {
  if (!eventKey || !Number.isInteger(attempt) || attempt < 0) throw new Error("订单事件键或尝试次数无效");
  const input = `${eventKey}#${attempt}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (code + i), 0x85ebca6b) >>> 0;
  }
  return `gpt${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}
