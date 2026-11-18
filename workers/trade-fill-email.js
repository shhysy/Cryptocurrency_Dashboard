const MAX_BODY_BYTES = 32 * 1024;
const MAX_EVENTS = 20;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const KV_PREFIX = "confirmed-fill:";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function hexToBytes(hex) {
  if (!/^[a-f0-9]{64}$/i.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function verifySignature(rawBody, timestamp, signature, secret) {
  const time = Number(timestamp);
  if (!Number.isSafeInteger(time) || Math.abs(Date.now() - time) > MAX_CLOCK_SKEW_MS) return false;
  const signatureBytes = hexToBytes(signature);
  if (!signatureBytes || typeof secret !== "string" || secret.length < 32) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${timestamp}.${rawBody}`);
  return crypto.subtle.verify("HMAC", key, signatureBytes, signed);
}

function isFinitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validateEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return "事件格式无效";
  if (event.type !== "confirmed_trade_fill") return "只接受已确认成交事件";
  if (event.side !== "BUY" && event.side !== "SELL") return "成交方向无效";
  if (typeof event.symbol !== "string" || !/^[A-Z0-9]{3,20}$/.test(event.symbol)) return "交易对无效";
  if (typeof event.fillId !== "string" || !/^[0-9]{1,32}$/.test(event.fillId)) return "成交 ID 无效";
  if (event.id !== `trade-fill:${event.symbol}:${event.fillId}`) return "事件幂等 ID 不匹配";
  if (typeof event.exchangeOrderId !== "string" || !/^[0-9]{1,32}$/.test(event.exchangeOrderId)) return "交易所订单 ID 无效";
  if (!isFinitePositive(event.filledQty) || !isFinitePositive(event.fillPrice) || !isFinitePositive(event.quoteQty)) return "成交数量、价格或金额无效";
  if (typeof event.commission !== "number" || !Number.isFinite(event.commission) || event.commission < 0) return "手续费无效";
  if (typeof event.commissionUsdt !== "number" || !Number.isFinite(event.commissionUsdt) || event.commissionUsdt < 0) return "USDT 手续费估值无效";
  if (typeof event.commissionAsset !== "string" || !/^[A-Z0-9]{1,20}$/.test(event.commissionAsset)) return "手续费资产无效";
  if (!Number.isSafeInteger(event.filledAt) || event.filledAt <= 0) return "成交时间无效";
  return null;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function formatNumber(value, digits = 8) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: digits });
}

function buildEmail(events) {
  const subject = events.length === 1
    ? `【成交确认】${events[0].side === "BUY" ? "买入" : "卖出"} ${events[0].symbol}`
    : `【成交确认】本次新增 ${events.length} 笔买卖成交`;
  const rows = events.map((event) => {
    const side = event.side === "BUY" ? "买入" : "卖出";
    const time = new Date(event.filledAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
    return `<tr>
      <td>${side}</td><td>${escapeHtml(event.symbol)}</td>
      <td>${formatNumber(event.filledQty)}</td><td>${formatNumber(event.fillPrice, 8)}</td>
      <td>${formatNumber(event.quoteQty, 4)}</td><td>${formatNumber(event.commission, 8)} ${escapeHtml(event.commissionAsset)}</td>
      <td>${escapeHtml(time)}</td><td>${escapeHtml(event.exchangeOrderId)}</td>
    </tr>`;
  }).join("");
  const text = events.map((event) => [
    event.side === "BUY" ? "买入成交" : "卖出成交",
    `交易对：${event.symbol}`,
    `成交数量：${formatNumber(event.filledQty)}`,
    `成交价格：${formatNumber(event.fillPrice)}`,
    `成交金额：${formatNumber(event.quoteQty, 4)} USDT`,
    `手续费：${formatNumber(event.commission)} ${event.commissionAsset}`,
    `订单 ID：${event.exchangeOrderId}`,
    `成交时间：${new Date(event.filledAt).toISOString()}`,
  ].join("\n")).join("\n\n");
  const html = `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#0f172a">
    <h2>Binance 现货真实成交确认</h2>
    <p>以下记录来自执行端已核验并入队的成交事件。邮件仅作成交记录，不代表账户余额或持仓快照。</p>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <thead><tr style="background:#f1f5f9"><th>方向</th><th>交易对</th><th>数量</th><th>成交价</th><th>成交额</th><th>手续费</th><th>成交时间（北京时间）</th><th>订单 ID</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
  return { subject, text, html };
}

async function sendEmail(env, message, idempotencyKey) {
  const to = String(env.MAIL_TO ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || to.length === 0) {
    throw new Error("邮件配置缺失：RESEND_API_KEY、MAIL_FROM、MAIL_TO");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ from: env.MAIL_FROM, to, ...message }),
  });
  if (!response.ok) {
    throw new Error(`Resend 请求失败：HTTP ${response.status} ${(await response.text()).slice(0, 160)}`);
  }
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, 405);
    if (!env.TRADE_FILL_NOTIFICATIONS) return json({ ok: false, error: "KV 未绑定" }, 503);

    const contentLength = Number(request.headers.get("Content-Length") ?? 0);
    if (contentLength > MAX_BODY_BYTES) return json({ ok: false, error: "请求体过大" }, 413);
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return json({ ok: false, error: "请求体过大" }, 413);

    try {
      const timestamp = request.headers.get("X-Trade-Timestamp") ?? "";
      const signature = request.headers.get("X-Trade-Signature") ?? "";
      const valid = await verifySignature(rawBody, timestamp, signature, env.TRADE_NOTIFY_HMAC_SECRET);
      if (!valid) return json({ ok: false, error: "签名无效或请求已过期" }, 401);

      const body = JSON.parse(rawBody);
      if (!body || !Array.isArray(body.events) || body.events.length === 0 || body.events.length > MAX_EVENTS) {
        return json({ ok: false, error: "events 必须为 1 至 20 条成交事件" }, 400);
      }
      const ids = new Set();
      for (const event of body.events) {
        const error = validateEvent(event);
        if (error) return json({ ok: false, error }, 400);
        if (ids.has(event.id)) return json({ ok: false, error: "批次中存在重复事件 ID" }, 400);
        ids.add(event.id);
      }

      const fresh = [];
      for (const event of body.events) {
        const sent = await env.TRADE_FILL_NOTIFICATIONS.get(KV_PREFIX + encodeURIComponent(event.id));
        if (!sent) fresh.push(event);
      }
      if (fresh.length === 0) return json({ ok: true, accepted: 0, duplicate: body.events.length });

      const batchKey = fresh.map((event) => event.id).sort().join("|");
      await sendEmail(env, buildEmail(fresh), `trade-fill-${await digestHex(batchKey)}`);
      const sentAt = Date.now();
      await Promise.all(fresh.map((event) => env.TRADE_FILL_NOTIFICATIONS.put(
        KV_PREFIX + encodeURIComponent(event.id),
        JSON.stringify({ sentAt, side: event.side, symbol: event.symbol, fillId: event.fillId }),
        { expirationTtl: 60 * 60 * 24 * 365 },
      )));
      return json({ ok: true, accepted: fresh.length, duplicate: body.events.length - fresh.length });
    } catch (error) {
      console.error("[trade-fill-email]", error instanceof Error ? error.message : String(error));
      return json({ ok: false, error: "成交邮件发送失败，事件未标记为已发送" }, 502);
    }
  },
};

async function digestHex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
