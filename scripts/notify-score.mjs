/**
 * 分数达标邮件通知（QQ 邮箱 SMTP）。
 *
 * 用法：
 *   1. 在项目根目录编辑唯一的 .env（填写 SMTP_*、币安 Key、两个门槛分）
 *   2. 本机先 npm run dev
 *   3. npm run notify          常驻运行，每 60 秒检查一次（Ctrl+C 退出）
 *      npm run notify -- --once  只检查一次就退出
 *
 * 冷却：MAIL_COOLDOWN_HOURS（小时，0 = 无冷却，每次检查达标都发）。
 * 每轮都会重新读取 .env，改门槛或冷却不用重启。
 *
 * 门槛（写在 .env）：
 *   MAIL_MIN_SCORE_CORE=55   # 核心：BTC、PAXG
 *   MAIL_MIN_SCORE_ALT=75    # 山寨：ETH、BNB、UNI、CL 等
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { connect as tlsConnect } from "node:tls";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnv() {
  const out = { ...process.env };
  const p = resolve(root, ".env");
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (out[k] === undefined) out[k] = v;
    }
  }
  return out;
}

let env, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_TO, MAIL_FROM;
let DASHBOARD_URL, REQUIRE_STABLE, SCORE_CORE, SCORE_ALT, COOLDOWN_MS, COOLDOWN_HOURS;

/** 解析数字；空值或无效时用默认值（0 是有效值） */
function num(v, def) {
  const n = parseFloat(String(v ?? "").trim());
  return Number.isFinite(n) ? n : def;
}

/** 每轮检查前重新读 .env，改配置不用重启 */
function loadConfig() {
  env = loadEnv();
  SMTP_HOST = env.SMTP_HOST || "smtp.qq.com";
  SMTP_PORT = num(env.SMTP_PORT, 465);
  SMTP_USER = env.SMTP_USER || "";
  SMTP_PASS = env.SMTP_PASS || "";
  MAIL_TO = env.MAIL_TO || "2157936243@qq.com";
  MAIL_FROM = env.MAIL_FROM || SMTP_USER;
  DASHBOARD_URL = (env.DASHBOARD_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
  REQUIRE_STABLE = env.MAIL_REQUIRE_STABLE === "1";
  /** 核心币（BTC/PAXG 等）邮件门槛，默认 55 — 在 .env 用 MAIL_MIN_SCORE_CORE 改 */
  SCORE_CORE = num(env.MAIL_MIN_SCORE_CORE, 55);
  /** 山寨币邮件门槛，默认 75 — 在 .env 用 MAIL_MIN_SCORE_ALT 改 */
  SCORE_ALT = num(env.MAIL_MIN_SCORE_ALT, 75);
  /** 冷却小时数；0 = 无冷却，每次检查达标都发 */
  COOLDOWN_HOURS = Math.max(0, num(env.MAIL_COOLDOWN_HOURS, 24));
  COOLDOWN_MS = COOLDOWN_HOURS * 3600_000;
}

const CHECK_INTERVAL_MS = 60_000;
const STATE_PATH = resolve(root, "data/notify-state.json");

const CN_NAME = {
  BTC: "比特币",
  ETH: "以太坊",
  BNB: "币安币",
  UNI: "Uniswap",
  PAXG: "黄金(PAXG)",
  CL: "原油(WTI)",
};

function displayName(symbol, fallback) {
  return CN_NAME[symbol] || fallback || symbol;
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { last: {} };
  }
}

function writeState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function sendMail({ subject, text }) {
  if (!SMTP_USER || !SMTP_PASS) throw new Error("请在 .env 设置 SMTP_USER 与 SMTP_PASS（QQ 授权码）");
  if (!MAIL_TO) throw new Error("请设置 MAIL_TO");

  return new Promise((resolvePromise, reject) => {
    const socket = tlsConnect({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST }, () => {
      let buf = "";
      let step = 0;
      const send = (cmd) => socket.write(cmd + "\r\n");
      const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

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
              send(`EHLO localhost`);
              step = 1;
            } else if (step === 1 && code === "250") {
              send("AUTH LOGIN");
              step = 2;
            } else if (step === 2 && code === "334") {
              send(b64(SMTP_USER));
              step = 3;
            } else if (step === 3 && code === "334") {
              send(b64(SMTP_PASS));
              step = 4;
            } else if (step === 4 && code === "235") {
              send(`MAIL FROM:<${MAIL_FROM}>`);
              step = 5;
            } else if (step === 5 && code === "250") {
              send(`RCPT TO:<${MAIL_TO}>`);
              step = 6;
            } else if (step === 6 && code === "250") {
              send("DATA");
              step = 7;
            } else if (step === 7 && code === "354") {
              const body =
                `From: ${MAIL_FROM}\r\n` +
                `To: ${MAIL_TO}\r\n` +
                `Subject: =?UTF-8?B?${b64(subject)}?=\r\n` +
                `MIME-Version: 1.0\r\n` +
                `Content-Type: text/plain; charset=utf-8\r\n` +
                `\r\n` +
                text.replace(/\r?\n/g, "\r\n") +
                `\r\n.`;
              send(body);
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

async function fetchDashboard() {
  const headers = { Accept: "application/json" };
  const pass = env.DASHBOARD_PASSWORD;
  if (pass) headers.Authorization = "Basic " + Buffer.from(`user:${pass}`).toString("base64");
  const url = `${DASHBOARD_URL}/api/dashboard`;
  const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`拉取看板失败 HTTP ${res.status} ${url}`);
  return res.json();
}

function thresholdFor(group) {
  return group === "core" ? SCORE_CORE : SCORE_ALT;
}

function groupLabel(group) {
  return group === "core" ? "核心" : "山寨";
}

function pickHits(data) {
  const hits = [];
  for (const c of data.coins || []) {
    const score = c.signal?.score ?? 0;
    const group = c.signal?.group || "alt";
    const minScore = thresholdFor(group);
    if (score < minScore) continue;
    if (REQUIRE_STABLE && !c.signal?.metrics?.stabilized) continue;
    hits.push({
      symbol: c.symbol,
      name: displayName(c.symbol, c.name),
      group,
      score,
      minScore,
      tag: c.signal?.tag || "",
      kind: c.signal?.kind || "",
      stabilized: c.signal?.metrics?.stabilized,
      stableCount: c.signal?.metrics?.stableCount,
      blocked: c.signal?.action?.blocked || [],
      actionLabel: c.signal?.action?.label || "",
      reasons: (c.signal?.reasons || []).map((r) => r.text).slice(0, 6),
    });
  }
  return hits;
}

/** 邮件正文：写清「哪个币、到了多少分、对应哪条门槛」 */
function buildMail(hits) {
  const subject = `【信号看板】` + hits.map((h) => `${h.name}到${h.score}分`).join("、");

  const summaryLines = hits.map((h) => {
    const g = groupLabel(h.group);
    return `  · ${h.name}（${h.symbol}）当前 ${h.score} 分，已达到${g}门槛 ${h.minScore} 分`;
  });

  const blocks = hits.map((h, i) => {
    const g = groupLabel(h.group);
    const stable =
      h.stabilized === true
        ? `已企稳（满足 ${h.stableCount ?? "?"} 项）`
        : h.stabilized === false
          ? `尚未企稳（目前 ${h.stableCount ?? "?"} 项）`
          : "企稳数据不足";
    const status = h.tag || h.kind || "观望";
    const action = h.actionLabel ? `建议动作：${h.actionLabel}` : "建议动作：仅提醒分数，请打开看板确认";
    const blocked = h.blocked.length ? `暂未给买入金额的原因：${h.blocked.join("；")}` : "";
    const why =
      h.reasons.length > 0
        ? h.reasons.map((r) => `      · ${r}`).join("\n")
        : "      · （暂无明细依据）";

    return [
      `【${i + 1}】${h.name}（代码 ${h.symbol}）`,
      `      当前机会指数：${h.score} 分（满分 90）`,
      `      本次触发门槛：${h.minScore} 分（${g}组，配置项 MAIL_MIN_SCORE_${h.group === "core" ? "CORE" : "ALT"}）`,
      `      超出门槛：${Math.max(0, h.score - h.minScore)} 分`,
      `      信号状态：${status} · ${stable}`,
      `      ${action}`,
      blocked ? `      ${blocked}` : null,
      `      评分依据：`,
      why,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const text = [
    "长期投资信号看板 — 分数达标通知",
    "",
    "有币种的机会指数已经达到你在 .env 里设置的邮件门槛，详情如下。",
    "",
    "【一句话摘要】",
    ...summaryLines,
    "",
    `（当前配置：核心 MAIL_MIN_SCORE_CORE=${SCORE_CORE}，山寨 MAIL_MIN_SCORE_ALT=${SCORE_ALT}` +
      (REQUIRE_STABLE ? "，且要求企稳" : "") +
      "）",
    "",
    "【详细说明】",
    "────────────────",
    ...blocks.flatMap((b) => [b, "────────────────"]),
    "",
    `打开看板查看：${DASHBOARD_URL}`,
    `发送时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    COOLDOWN_HOURS > 0 ? `同一币种约 ${COOLDOWN_HOURS} 小时内不会重复发送。` : "当前未设置冷却，每次检查达标都会发送。",
    "",
    "本邮件由脚本 scripts/notify-score.mjs 自动发出，信号仅供参考，不构成投资建议。",
  ].join("\n");

  return { subject, text };
}

async function checkOnce() {
  loadConfig();
  const state = readState();
  const now = Date.now();
  const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });

  const data = await fetchDashboard();
  const hits = pickHits(data);
  console.log(
    `[notify ${ts}] 门槛 核心${SCORE_CORE}/山寨${SCORE_ALT}，冷却 ${COOLDOWN_HOURS}h，达标 ${hits.length} 个:`,
    hits.map((h) => `${h.name}=${h.score}`).join(", ") || "(无)",
  );

  // 冷却内一律不重复发；冷却为 0 时每次达标都发
  const toSend = hits.filter((h) => {
    const prev = state.last?.[h.symbol];
    return !prev || now - prev.at >= COOLDOWN_MS;
  });
  if (!toSend.length) return;

  const { subject, text } = buildMail(toSend);
  console.log(`[notify ${ts}] 发送至 ${MAIL_TO}：${subject}`);
  await sendMail({ subject, text });
  state.last = state.last || {};
  for (const h of toSend) state.last[h.symbol] = { at: now, score: h.score };
  writeState(state);
  console.log(`[notify ${ts}] 已发送`);
}

if (process.argv.includes("--once")) {
  await checkOnce();
} else {
  console.log(`[notify] 常驻模式：每 ${CHECK_INTERVAL_MS / 1000} 秒检查一次，Ctrl+C 退出`);
  for (;;) {
    try {
      await checkOnce();
    } catch (e) {
      console.error(`[notify] 本轮失败（下轮继续）：${e.message}`);
    }
    await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS));
  }
}
