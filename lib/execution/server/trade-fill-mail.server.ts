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


export function isTraderAlertMailEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TRADER_ALERT_MAIL_ENABLED === "1";
}

/** 只发送Trader自身的关键安全告警；独立开关，不受成交邮件开关影响。 */
export async function dispatchTraderAlertMail(event: {
  id: string;
  severity: "critical";
  title: string;
  message: string;
  occurredAt: number;
}): Promise<{ ok: boolean; sent: boolean; reason?: string }> {
  if (!isTraderAlertMailEnabled()) {
    return { ok: true, sent: false, reason: "TRADER_ALERT_MAIL_ENABLED未启用" };
  }
  if (!event.id.startsWith("trader-alert:") || !event.title.trim() ||
      !event.message.trim() || !Number.isSafeInteger(event.occurredAt)) {
    return { ok: false, sent: false, reason: "Trader告警邮件载荷无效" };
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS ||
      !(process.env.MAIL_TO || process.env.SMTP_USER)) {
    return { ok: false, sent: false, reason: "SMTP_HOST/SMTP_USER/SMTP_PASS/MAIL_TO未完整配置" };
  }
  try {
    const body = [
      "自动交易Trader关键故障告警",
      "",
      `事件：${event.title}`,
      `级别：${event.severity}`,
      `时间：${new Date(event.occurredAt).toISOString()}`,
      `事件ID：${event.id}`,
      "",
      event.message,
      "",
      "系统已写入 data/STOP；请先检查本地Trader日志和订单对账状态，确认安全后再人工恢复。",
    ].join("\n");
    await sendSmtpTextMail(`【自动交易紧急告警】${event.title}`, redactSecrets(body));
    return { ok: true, sent: true };
  } catch (error) {
    return {
      ok: false,
      sent: false,
      reason: redactSecrets(error instanceof Error ? error.message : "Trader告警邮件发送失败"),
    };
  }
}
