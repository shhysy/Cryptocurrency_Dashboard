import { connect as tlsConnect } from "node:tls";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DashboardData } from "@/lib/types";

const CN: Record<string, string> = {
  BTC: "比特币",
  ETH: "以太坊",
  BNB: "币安币",
  UNI: "Uniswap",
  PAXG: "黄金(PAXG)",
  CL: "原油(WTI)",
};

export type NotifyHit = {
  symbol: string;
  name: string;
  group: string;
  score: number;
  minScore: number;
  tag: string;
  stabilized: boolean | null | undefined;
  stableCount: number | null | undefined;
  blocked: string[];
  actionLabel: string;
  reasons: string[];
};

export type NotifyResult =
  | { ok: true; sent: false; reason: string; hits: NotifyHit[] }
  | { ok: true; sent: true; hits: NotifyHit[]; to: string }
  | { ok: false; error: string };

function scoreCore() {
  return Number(process.env.MAIL_MIN_SCORE_CORE ?? 55);
}
function scoreAlt() {
  return Number(process.env.MAIL_MIN_SCORE_ALT ?? 75);
}
function requireStable() {
  return process.env.MAIL_REQUIRE_STABLE === "1";
}
/** 冷却小时数；0 = 无冷却；空值或无效值用 24 */
function cooldownHours() {
  const n = parseFloat(String(process.env.MAIL_COOLDOWN_HOURS ?? "").trim());
  return Number.isFinite(n) ? Math.max(0, n) : 24;
}
function cooldownMs() {
  return cooldownHours() * 3600_000;
}

function statePath() {
  return join(process.cwd(), "data", "notify-state.json");
}

function readState(): { last: Record<string, { at: number; score: number }> } {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8"));
  } catch {
    return { last: {} };
  }
}

function writeState(state: { last: Record<string, { at: number; score: number }> }) {
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

function pickHits(data: DashboardData): NotifyHit[] {
  const core = scoreCore();
  const alt = scoreAlt();
  const hits: NotifyHit[] = [];
  for (const c of data.coins) {
    const group = c.signal?.group || "alt";
    const minScore = group === "core" ? core : alt;
    const score = c.signal?.score ?? 0;
    if (score < minScore) continue;
    if (requireStable() && !c.signal?.metrics?.stabilized) continue;
    hits.push({
      symbol: c.symbol,
      name: CN[c.symbol] || c.name || c.symbol,
      group,
      score,
      minScore,
      tag: c.signal?.tag || "",
      stabilized: c.signal?.metrics?.stabilized,
      stableCount: c.signal?.metrics?.stableCount,
      blocked: c.signal?.action?.blocked || [],
      actionLabel: c.signal?.action?.label || "",
      reasons: (c.signal?.reasons || []).map((r) => r.text).slice(0, 6),
    });
  }
  return hits;
}

function filterCooldown(hits: NotifyHit[]) {
  const state = readState();
  const now = Date.now();
  const cd = cooldownMs();
  return hits.filter((h) => {
    const prev = state.last?.[h.symbol];
    // 冷却内一律不重发；冷却为 0 时每次达标都发
    return !prev || now - prev.at >= cd;
  });
}

function buildMail(hits: NotifyHit[]) {
  const subject = `【信号看板】` + hits.map((h) => `${h.name}到${h.score}分`).join("、");
  const core = scoreCore();
  const alt = scoreAlt();
  const summary = hits.map(
    (h) =>
      `  · ${h.name}（${h.symbol}）当前 ${h.score} 分，已达到${h.group === "core" ? "核心" : "山寨"}门槛 ${h.minScore} 分`,
  );
  const blocks = hits.map((h, i) => {
    const stable =
      h.stabilized === true
        ? `已企稳（${h.stableCount ?? "?"} 项）`
        : h.stabilized === false
          ? `尚未企稳（${h.stableCount ?? "?"} 项）`
          : "企稳数据不足";
    const why = h.reasons.length
      ? h.reasons.map((r) => `      · ${r}`).join("\n")
      : "      · （暂无明细依据）";
    return [
      `【${i + 1}】${h.name}（代码 ${h.symbol}）`,
      `      当前机会指数：${h.score} 分（满分 90）`,
      `      本次触发门槛：${h.minScore} 分（${h.group === "core" ? "核心" : "山寨"}）`,
      `      超出门槛：${Math.max(0, h.score - h.minScore)} 分`,
      `      信号状态：${h.tag || "—"} · ${stable}`,
      h.actionLabel ? `      建议动作：${h.actionLabel}` : null,
      h.blocked.length ? `      暂缓原因：${h.blocked.join("；")}` : null,
      `      评分依据：`,
      why,
    ]
      .filter(Boolean)
      .join("\n");
  });
  const text = [
    "长期投资信号看板 — 分数达标通知（页面加载自动检测）",
    "",
    "【一句话摘要】",
    ...summary,
    "",
    `（配置：MAIL_MIN_SCORE_CORE=${core}，MAIL_MIN_SCORE_ALT=${alt}` +
      (requireStable() ? "，需企稳" : "") +
      "）",
    "",
    "【详细说明】",
    "────────────────",
    ...blocks.flatMap((b) => [b, "────────────────"]),
    "",
    `时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    cooldownHours() > 0
      ? `同一币种约 ${cooldownHours()} 小时内不重复发送。`
      : "当前未设置冷却，每次检查达标都会发送。",
    "",
    "信号仅供参考，不构成投资建议。",
  ].join("\n");
  return { subject, text };
}

function sendSmtp(subject: string, text: string): Promise<void> {
  const host = process.env.SMTP_HOST || "smtp.qq.com";
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const to = process.env.MAIL_TO || user;
  const from = process.env.MAIL_FROM || user;
  if (!user || !pass) return Promise.reject(new Error("未配置 SMTP_USER / SMTP_PASS"));
  if (!to) return Promise.reject(new Error("未配置 MAIL_TO"));

  return new Promise((resolvePromise, reject) => {
    const socket = tlsConnect({ host, port, servername: host }, () => {
      let buf = "";
      let step = 0;
      const send = (cmd: string) => socket.write(cmd + "\r\n");
      const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

      socket.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        const parts = buf.split(/\r?\n/);
        buf = parts.pop() || "";
        for (const line of parts) {
          if (!line) continue;
          const code = line.slice(0, 3);
          if (line.length >= 4 && line[3] === "-") continue;
          try {
            if (step === 0 && code === "220") {
              send("EHLO localhost");
              step = 1;
            } else if (step === 1 && code === "250") {
              send("AUTH LOGIN");
              step = 2;
            } else if (step === 2 && code === "334") {
              send(b64(user));
              step = 3;
            } else if (step === 3 && code === "334") {
              send(b64(pass));
              step = 4;
            } else if (step === 4 && code === "235") {
              send(`MAIL FROM:<${from}>`);
              step = 5;
            } else if (step === 5 && code === "250") {
              send(`RCPT TO:<${to}>`);
              step = 6;
            } else if (step === 6 && code === "250") {
              send("DATA");
              step = 7;
            } else if (step === 7 && code === "354") {
              send(
                `From: ${from}\r\nTo: ${to}\r\nSubject: =?UTF-8?B?${b64(subject)}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n` +
                  text.replace(/\r?\n/g, "\r\n") +
                  "\r\n.",
              );
              step = 8;
            } else if (step === 8 && code === "250") {
              send("QUIT");
              step = 9;
            } else if (step === 9 && (code === "221" || code === "250")) {
              socket.end();
              resolvePromise();
            } else if (code[0] === "4" || code[0] === "5") {
              reject(new Error(`SMTP ${line}`));
              socket.end();
            }
          } catch (e) {
            reject(e);
            socket.end();
          }
        }
      });
      socket.on("error", reject);
      socket.on("end", () => {
        if (step < 9) reject(new Error("SMTP 连接意外关闭"));
      });
    });
    socket.on("error", reject);
  });
}

let inFlight: Promise<NotifyResult> | null = null;

/** 根据看板数据检测分数并按需发邮件（含冷却去重）。多个标签页同时请求时共用同一次检查，避免重复发信。 */
export function runScoreMailNotify(data: DashboardData): Promise<NotifyResult> {
  if (inFlight) return inFlight;
  inFlight = doScoreMailNotify(data).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doScoreMailNotify(data: DashboardData): Promise<NotifyResult> {
  if (process.env.MAIL_AUTO === "0") {
    return { ok: true, sent: false, reason: "MAIL_AUTO=0 已关闭自动邮件", hits: [] };
  }
  if (!process.env.SMTP_PASS || !process.env.SMTP_USER) {
    return { ok: true, sent: false, reason: "未配置 SMTP，跳过发信", hits: [] };
  }

  const hits = pickHits(data);
  if (!hits.length) {
    return { ok: true, sent: false, reason: "无币种达到邮件门槛", hits: [] };
  }
  const toSend = filterCooldown(hits);
  if (!toSend.length) {
    return { ok: true, sent: false, reason: "达标币种仍在冷却期内", hits };
  }

  const { subject, text } = buildMail(toSend);
  try {
    await sendSmtp(subject, text);
    const state = readState();
    const now = Date.now();
    state.last = state.last || {};
    for (const h of toSend) {
      state.last[h.symbol] = { at: now, score: h.score };
    }
    writeState(state);
    return {
      ok: true,
      sent: true,
      hits: toSend,
      to: process.env.MAIL_TO || process.env.SMTP_USER || "",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
