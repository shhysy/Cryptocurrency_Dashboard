/**
 * 分数达标邮件通知（QQ 邮箱 SMTP）。
 *
 * 用法：
 *   1. 在项目根目录编辑唯一的 .env（填写 SMTP_*、币安 Key 等）
 *   2. 本机先 npm run dev
 *   3. npm run notify
 *
 * 门槛区分：核心 MAIL_MIN_SCORE_CORE（默认 55），山寨 MAIL_MIN_SCORE_ALT（默认 75）
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

const env = loadEnv();

const SMTP_HOST = env.SMTP_HOST || "smtp.qq.com";
const SMTP_PORT = Number(env.SMTP_PORT || 465);
const SMTP_USER = env.SMTP_USER || "";
const SMTP_PASS = env.SMTP_PASS || "";
const MAIL_TO = env.MAIL_TO || "2157936243@qq.com";
const MAIL_FROM = env.MAIL_FROM || SMTP_USER;
const DASHBOARD_URL = (env.DASHBOARD_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const REQUIRE_STABLE = env.MAIL_REQUIRE_STABLE === "1";
/** 核心币（BTC/PAXG 等）邮件门槛，默认 55 */
const SCORE_CORE = Number(env.MAIL_MIN_SCORE_CORE ?? 55);
/** 山寨币邮件门槛，默认 75 */
const SCORE_ALT = Number(env.MAIL_MIN_SCORE_ALT ?? 75);
const COOLDOWN_MS = Number(env.MAIL_COOLDOWN_HOURS || 24) * 3600_000;
const STATE_PATH = resolve(root, "data/notify-state.json");

/** 邮件展示用中文名（API 里多为英文） */
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

/** 邮件正文模板：中文名 + 代码 + 具体分数 */
function buildMail(hits) {
  const subjectBits = hits.map((h) => `${h.name} ${h.score}分`);
  const subject = `【信号看板】${subjectBits.join("、")}`;

  const blocks = hits.map((h, i) => {
    const stable =
      h.stabilized === true
        ? `已企稳（${h.stableCount ?? "?"} 项）`
        : h.stabilized === false
          ? `未企稳（${h.stableCount ?? "?"} 项）`
          : "企稳数据不足";
    const status = h.tag || h.kind || "—";
    const action = h.actionLabel ? `建议动作：${h.actionLabel}` : "";
    const blocked = h.blocked.length ? `当前挡住：${h.blocked.join("；")}` : "";
    const why = h.reasons.length ? h.reasons.map((r) => `    · ${r}`).join("\n") : "    · （无明细依据）";

    return [
      `【${i + 1}】${h.name}（${h.symbol}）`,
      `    机会指数：${h.score} 分 / 满分 90`,
      `    邮件门槛：${h.minScore} 分（${groupLabel(h.group)}）`,
      `    状态：${status} · ${stable}`,
      action ? `    ${action}` : null,
      blocked ? `    ${blocked}` : null,
      `    依据：`,
      why,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const summaryLines = hits.map(
    (h) => `  ${h.name}（${h.symbol}）  ${h.score} 分（门槛 ${h.minScore}）`,
  );

  const text = [
    "长期投资信号看板 · 分数提醒",
    "",
    "一、达标摘要",
    ...summaryLines,
    "",
    `核心门槛 ${SCORE_CORE} 分 · 山寨门槛 ${SCORE_ALT} 分` + (REQUIRE_STABLE ? " · 需企稳" : ""),
    "",
    "二、明细",
    "————————",
    ...blocks.flatMap((b) => [b, "————————"]),
    "",
    `看板：${DASHBOARD_URL}`,
    `时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    `说明：同一币种约 ${env.MAIL_COOLDOWN_HOURS || 24} 小时内不重复通知`,
    "",
    "（信号仅供参考，不构成投资建议）",
  ].join("\n");

  return { subject, text };
}

const state = readState();
const now = Date.now();

console.log(`[notify] 门槛：核心 ${SCORE_CORE} / 山寨 ${SCORE_ALT}${REQUIRE_STABLE ? " · 需企稳" : ""}`);
console.log(`[notify] 拉取 ${DASHBOARD_URL}/api/dashboard …`);
const data = await fetchDashboard();
const hits = pickHits(data);
console.log(
  `[notify] 达标 ${hits.length} 个:`,
  hits.map((h) => `${h.name}(${h.symbol})=${h.score}`).join(", ") || "(无)",
);

const toSend = hits.filter((h) => {
  const prev = state.last?.[h.symbol];
  if (!prev) return true;
  if (now - prev.at < COOLDOWN_MS && prev.score === h.score) return false;
  if (now - prev.at < COOLDOWN_MS && h.score <= prev.score) return false;
  return true;
});

if (!toSend.length) {
  console.log("[notify] 无需发信（无新达标或仍在冷却）");
  process.exit(0);
}

const { subject, text } = buildMail(toSend);
console.log(`[notify] 主题: ${subject}`);
console.log(`[notify] 发送至 ${MAIL_TO} …`);
await sendMail({ subject, text });
for (const h of toSend) {
  state.last = state.last || {};
  state.last[h.symbol] = { at: now, score: h.score };
}
writeState(state);
console.log("[notify] 已发送");
