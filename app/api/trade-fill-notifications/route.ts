import { signTradeNotificationRequest } from "@/lib/execution/notification-signature.server";
import { verifyCloudflareAccessJwt } from "@/lib/execution/cloudflare-access.server";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_EVENTS = 20;

type ConfirmedFillEvent = {
  id: string;
  type: "confirmed_trade_fill";
  side: "BUY" | "SELL";
  symbol: string;
  fillId: string;
  exchangeOrderId: string;
  filledQty: number;
  fillPrice: number;
  quoteQty: number;
  commission: number;
  commissionAsset: string;
  commissionUsdt: number;
  filledAt: number;
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function validateEvent(value: unknown): value is ConfirmedFillEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (event.type !== "confirmed_trade_fill" ||
      (event.side !== "BUY" && event.side !== "SELL") ||
      typeof event.symbol !== "string" || !/^[A-Z0-9]{3,20}$/.test(event.symbol) ||
      typeof event.fillId !== "string" || !/^[0-9]{1,32}$/.test(event.fillId) ||
      event.id !== `trade-fill:${event.symbol}:${event.fillId}` ||
      typeof event.exchangeOrderId !== "string" || !/^[0-9]{1,32}$/.test(event.exchangeOrderId) ||
      typeof event.commissionAsset !== "string" || !/^[A-Z0-9]{1,20}$/.test(event.commissionAsset) ||
      !Number.isSafeInteger(event.filledAt) || Number(event.filledAt) <= 0) return false;

  const positive = [event.filledQty, event.fillPrice, event.quoteQty];
  const nonNegative = [event.commission, event.commissionUsdt];
  return positive.every((item) => typeof item === "number" && Number.isFinite(item) && item > 0) &&
    nonNegative.every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0);
}

/**
 * Authenticated same-origin relay:
 * Cloudflare Access authenticates the private dashboard user; this route signs
 * the validated outbox batch with a server-only HMAC before forwarding it.
 * The browser never receives the HMAC secret or Worker mail credentials.
 */
export async function POST(request: Request): Promise<Response> {
  const configuredOrigin = process.env.APP_ORIGIN ?? "";
  if (!configuredOrigin) return json({ ok: false, error: "APP_ORIGIN 尚未配置" }, 503);
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(configuredOrigin).origin;
  } catch {
    return json({ ok: false, error: "APP_ORIGIN 配置无效" }, 503);
  }
  if (request.headers.get("Origin") !== expectedOrigin) {
    return json({ ok: false, error: "请求来源不受允许" }, 403);
  }

  const identity = await verifyCloudflareAccessJwt(
    request.headers.get("Cf-Access-Jwt-Assertion"),
    {
      teamDomain: process.env.CF_ACCESS_TEAM_DOMAIN ?? "",
      audience: process.env.CF_ACCESS_AUD ?? "",
      allowedEmail: process.env.CF_ACCESS_ALLOWED_EMAIL,
    },
  );
  if (!identity.ok) return json({ ok: false, error: "需要有效的 Cloudflare Access 登录" }, 401);

  const workerUrl = process.env.TRADE_FILL_NOTIFY_URL ?? "";
  const hmacSecret = process.env.TRADE_NOTIFY_HMAC_SECRET ?? "";
  if (!workerUrl || hmacSecret.length < 32) {
    return json({ ok: false, error: "成交通知 Worker 或 HMAC Secret 尚未配置" }, 503);
  }
  try {
    const parsedUrl = new URL(workerUrl);
    if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
      return json({ ok: false, error: "成交通知 Worker URL 必须是 HTTPS 地址" }, 503);
    }
  } catch {
    return json({ ok: false, error: "成交通知 Worker URL 无效" }, 503);
  }

  const rawRequest = await request.text();
  if (new TextEncoder().encode(rawRequest).byteLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: "请求体过大" }, 413);
  }

  try {
    const body = JSON.parse(rawRequest) as { events?: unknown };
    if (!Array.isArray(body?.events) || body.events.length === 0 || body.events.length > MAX_EVENTS) {
      return json({ ok: false, error: "events 必须为 1 至 20 条成交事件" }, 400);
    }
    const events = body.events;
    if (!events.every(validateEvent)) {
      return json({ ok: false, error: "成交事件字段无效" }, 400);
    }
    const ids = new Set(events.map((event) => event.id));
    if (ids.size !== events.length) {
      return json({ ok: false, error: "批次中存在重复成交事件 ID" }, 400);
    }

    // Rebuild a minimal canonical payload; never forward browser-supplied state fields.
    const payload = JSON.stringify({ events });
    if (new TextEncoder().encode(payload).byteLength > MAX_BODY_BYTES) {
      return json({ ok: false, error: "规范化请求体过大" }, 413);
    }
    const signed = await signTradeNotificationRequest(payload, hmacSecret);
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Trade-Timestamp": signed.timestamp,
        "X-Trade-Signature": signed.signature,
      },
      body: payload,
      cache: "no-store",
    });
    const result = await response.json().catch(() => null) as {
      ok?: boolean; accepted?: number; duplicate?: number;
    } | null;
    if (!response.ok || result?.ok !== true ||
        !Number.isInteger(result.accepted) || !Number.isInteger(result.duplicate) ||
        result.accepted! + result.duplicate! !== events.length) {
      console.error("[trade-fill-notify] Worker rejected batch", response.status);
      return json({ ok: false, error: "邮件 Worker 未确认接收全部成交事件" }, 502);
    }
    return json({
      ok: true,
      accepted: result.accepted,
      duplicate: result.duplicate,
      count: events.length,
      identity: identity.email ?? "verified",
    });
  } catch (error) {
    console.error("[trade-fill-notify] relay failed", error instanceof Error ? error.message : String(error));
    return json({ ok: false, error: "成交通知转发失败" }, 502);
  }
}
