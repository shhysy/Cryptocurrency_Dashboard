/**
 * 分数达标邮件通知（QQ 邮箱 SMTP）。
 *
 * 用法：
 *   1. 复制 .env.example 为 .env，填写 SMTP_*、币安 Key 等
 *   2. 本机先 npm run dev（或 DASHBOARD_URL 指向已部署站点）
 *   3. node scripts/notify-score.mjs
 *   4. 可选 cron：每小时 0 分执行一次
 *
 * 注意：Cloudflare Workers 通常无法直连 smtp.qq.com，请在本机或 VPS 上跑本脚本。
 * 授权码只放环境变量，不要提交 Git。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { connect as tlsConnect } from "node:tls";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnv() {
  const out = { ...process.env };
  for (const name of [".env", ".env.local"]) {
    const p = resolve(root, name);
    if (!existsSync(p)) continue;
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
const COOLDOWN_MS = Number(env.MAIL_COOLDOWN_HOURS || 24) * 3600_000;
const STATE_PATH = resolve(root, "data/notify-state.json");

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

function pickHits(data) {
  const hits = [];
  for (const c of data.coins || []) {
    const score = c.signal?.score ?? 0;
    const group = c.signal?.group || "alt";
    const minScore = group === "core" ? 55 : 75;
    if (score < minScore) continue;
    if (REQUIRE_STABLE && !c.signal?.metrics?.stabilized) continue;
    hits.push({
      symbol: c.symbol,
      name: c.name,
      score,
      minScore,
      tag: c.signal?.tag,
      kind: c.signal?.kind,
      stabilized: c.signal?.metrics?.stabilized,
      stableCount: c.signal?.metrics?.stableCount,
      blocked: c.signal?.action?.blocked || [],
      reasons: (c.signal?.reasons || []).map((r) => r.text).slice(0, 5),
    });
  }
  return hits;
}

const state = readState();
const now = Date.now();

console.log(`[notify] 拉取 ${DASHBOARD_URL}/api/dashboard …`);
const data = await fetchDashboard();
const hits = pickHits(data);
console.log(`[notify] 达标币种 ${hits.length} 个:`, hits.map((h) => `${h.symbol}=${h.score}`).join(", ") || "(无)");

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

const lines = toSend.map((h) => {
  const st = h.stabilized ? `企稳 ${h.stableCount}` : h.stabilized === false ? `未企稳 ${h.stableCount ?? "?"}` : "企稳未知";
  const block = h.blocked.length ? `；挡住: ${h.blocked[0]}` : "";
  const why = h.reasons.length ? `\n  依据: ${h.reasons.join("；")}` : "";
  return `• ${h.symbol} (${h.name}) 机会指数 ${h.score}/90（门槛 ${h.minScore}）· ${h.tag || h.kind} · ${st}${block}${why}`;
});

const subject = `【信号看板】${toSend.map((h) => h.symbol).join("/")} 分数达标`;
const text =
  `长期投资信号看板 · 分数提醒\n\n` +
  `以下币种机会指数已达到对应买入门槛${REQUIRE_STABLE ? "（且已企稳）" : ""}：\n\n` +
  lines.join("\n\n") +
  `\n\n看板: ${DASHBOARD_URL}\n` +
  `时间: ${new Date().toISOString()}\n` +
  `（同一币种默认 ${env.MAIL_COOLDOWN_HOURS || 24} 小时内不重复通知）\n`;

console.log(`[notify] 发送至 ${MAIL_TO} …`);
await sendMail({ subject, text });
for (const h of toSend) {
  state.last = state.last || {};
  state.last[h.symbol] = { at: now, score: h.score };
}
writeState(state);
console.log("[notify] 已发送");
