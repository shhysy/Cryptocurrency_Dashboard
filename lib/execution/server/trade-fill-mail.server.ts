/**
 * 成交通知直发邮件适配器（本地SMTP，不经Cloudflare Worker）。
 * 只有TRADE_FILL_MAIL_ENABLED=1时才会发送；未启用不会谎报sent。
 */
import { sendSmtpTextMail } from "@/lib/mail-notify";
import { redactSecrets } from "./safe-log";

export function isTradeFillMailEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TRADE_FILL_MAIL_ENABLED === "1";
}

export type TradeFillMailPayload = {
  id: string;
  type?: string;
  side?: string;
  symbol?: string;
  filledQty?: number;
  fillPrice?: number;
};

export function buildTradeFillMailBody(events: TradeFillMailPayload[]): string {
  const lines = events.map((event) =>
    `- ${event.symbol ?? "?"} ${event.side ?? "?"} qty=${event.filledQty ?? "?"} @ ${event.fillPrice ?? "?"} id=${event.id}`,
  );
  return ["成交确认通知（仅包含已由Binance确认并入账的成交）", ...lines].join("\n");
}

export async function dispatchTradeFillMail(events: TradeFillMailPayload[]): Promise<{
  ok: boolean;
  sent: boolean;
  reason?: string;
}> {
  if (!isTradeFillMailEnabled()) {
    return { ok: true, sent: false, reason: "TRADE_FILL_MAIL_ENABLED未启用" };
  }
  if (!events.length) return { ok: true, sent: false, reason: "无事件" };
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS ||
      !(process.env.MAIL_TO || process.env.SMTP_USER)) {
    return { ok: false, sent: false, reason: "SMTP_HOST/SMTP_USER/SMTP_PASS/MAIL_TO未完整配置" };
  }

  const subject = `【自动交易成交确认】${events.length}笔成交`;
  const body = redactSecrets(buildTradeFillMailBody(events));
  try {
    await sendSmtpTextMail(subject, body);
    return { ok: true, sent: true };
  } catch (error) {
    const reason = redactSecrets(error instanceof Error ? error.message : "SMTP发送失败");
    return { ok: false, sent: false, reason };
  }
}
