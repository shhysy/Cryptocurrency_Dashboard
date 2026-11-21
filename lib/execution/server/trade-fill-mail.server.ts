/**
 * 成交通知直发邮件适配器（本地SMTP，不经Cloudflare Worker）。
 * 只有TRADE_FILL_MAIL_ENABLED=1时才会发送；未启用不会谎报sent。
 */
import { sendSmtpTextMail } from "@/lib/mail-notify";
import { redactSecrets } from "./safe-log";

export function isTradeFillMailEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TRADE_FILL_MAIL_ENABLED === "1" &&
    Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && (env.MAIL_TO || env.SMTP_USER));
}

export type TradeFillMailPayload = {
  id: string;
  type?: string;
  side?: string;
  symbol?: string;
  fillId?: string;
  exchangeOrderId?: string;
  filledQty?: number;
  fillPrice?: number;
  quoteQty?: number;
  commission?: number;
  commissionAsset?: string;
  commissionUsdt?: number;
  filledAt?: number;
  businessSnapshot?: {
    side: "BUY" | "SELL";
    strategyTier?: "head" | "add" | "reserve";
    sellKind?: "take_profit" | "indicator_profit" | "trail_stop" | "base_reduce";
    plannedUsdt?: string;
    cumulativeFilledQty: string;
    cumulativeQuoteQty: string;
    cumulativeCommissionUsdt: string;
    averageFillPrice: string;
    remainingBudgetUsdt?: string;
    realizedPnlUsdt?: number | null;
    remainingPositionQty?: number | null;
    accountingAvailable?: boolean;
  };
};

export function buildTradeFillMailBody(events: TradeFillMailPayload[]): string {
  const lines = events.flatMap((event) => {
    const sideLabel = event.side === "BUY" ? "买入成交" : event.side === "SELL" ? "卖出成交" : "现货成交";
    const time = Number.isSafeInteger(event.filledAt) && event.filledAt! > 0
      ? new Date(event.filledAt!).toISOString()
      : "时间未知";
    return [
      `【${sideLabel}】${event.symbol ?? "未知交易对"}`,
      `成交数量：${event.filledQty ?? "未知"}`,
      `实际成交价格：${event.fillPrice ?? "未知"}`,
      `实际成交金额：${event.quoteQty ?? "未知"} USDT`,
      `手续费：${event.commission ?? "未知"} ${event.commissionAsset ?? ""}（折合USDT：${event.commissionUsdt ?? "未知"}）`,
      `Binance订单ID：${event.exchangeOrderId ?? "未知"}`,
      `Binance成交ID：${event.fillId ?? event.id}`,
      `成交时间：${time}`,
      ...(event.businessSnapshot?.side === "BUY" ? [
        `策略档位：${event.businessSnapshot.strategyTier ?? "未知"}`,
        `计划买入金额：${event.businessSnapshot.plannedUsdt ?? "未知"} USDT`,
        `本订单累计成交数量：${event.businessSnapshot.cumulativeFilledQty}`,
        `本订单累计成交金额：${event.businessSnapshot.cumulativeQuoteQty} USDT`,
        `累计USDT手续费：${event.businessSnapshot.cumulativeCommissionUsdt} USDT`,
        `本订单累计成交均价：${event.businessSnapshot.averageFillPrice} USDT`,
        `剩余计划预算：${event.businessSnapshot.remainingBudgetUsdt ?? "未知"} USDT`,
      ] : []),
      ...(event.businessSnapshot?.side === "SELL" ? [
        `卖出类型：${event.businessSnapshot.sellKind ?? "未知"}`,
        `本订单累计卖出数量：${event.businessSnapshot.cumulativeFilledQty}`,
        `本订单累计卖出金额：${event.businessSnapshot.cumulativeQuoteQty} USDT`,
        `累计USDT手续费：${event.businessSnapshot.cumulativeCommissionUsdt} USDT`,
        `本订单累计卖出均价：${event.businessSnapshot.averageFillPrice} USDT`,
        `累计实现盈亏：${event.businessSnapshot.realizedPnlUsdt ?? "无法核算，请检查成交台账"} USDT`,
        `剩余持仓数量：${event.businessSnapshot.remainingPositionQty ?? "无法核算，请检查成交台账"}`,
      ] : []),
      "",
    ];
  });
  return ["成交确认通知（仅包含Binance已确认并写入SQLite台账的真实fill）", "", ...lines].join("\n");
}

export async function dispatchTradeFillMail(events: TradeFillMailPayload[]): Promise<{
  ok: boolean;
  sent: boolean;
  reason?: string;
}> {
  if (!isTradeFillMailEnabled()) {
    return { ok: true, sent: false, reason: "成交邮件未启用或SMTP尚未完整配置" };
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
