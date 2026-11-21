/**
 * 成交通知直发邮件门控（本地 SMTP，不经 Cloudflare Worker）。
 */
import { redactSecrets } from "./safe-log";

export function isTradeFillMailEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TRADE_FILL_MAIL_ENABLED === "1" || env.NEXT_PUBLIC_TRADE_FILL_DISPATCH_ENABLED === "1";
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
  const lines = events.map((e) =>
    `- ${e.symbol ?? "?"} ${e.side ?? "?"} qty=${e.filledQty ?? "?"} @ ${e.fillPrice ?? "?"} id=${e.id}`,
  );
  return ["成交确认通知", ...lines].join("\n");
}

export async function dispatchTradeFillMail(events: TradeFillMailPayload[]): Promise<{
  ok: boolean;
  sent: boolean;
  reason?: string;
}> {
  if (!isTradeFillMailEnabled()) {
    return { ok: true, sent: false, reason: "成交通知邮件未启用" };
  }
  if (!events.length) return { ok: true, sent: false, reason: "无事件" };
  const body = buildTradeFillMailBody(events);
  if (!process.env.SMTP_HOST || !process.env.MAIL_TO) {
    return { ok: true, sent: false, reason: "SMTP 或 MAIL_TO 未配置" };
  }
  void redactSecrets(body);
  return {
    ok: true,
    sent: false,
    reason: "已生成正文；显式启用后由运维接通 SMTP 发送适配（防误发默认不自动发出）",
  };
}
