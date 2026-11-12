// 用 Chrome DevTools 协议做真正的手机视口截图，并检测横向溢出。
// 用法: node mobile-shot.mjs <url> <out.png> [width]
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, out, widthArg] = process.argv.slice(2);
const width = Number(widthArg || 390);
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const port = 9333;
const proc = spawn(chrome, [
  "--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "cdp-"))}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 40; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { await sleep(250); }
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

await send("Page.enable");
await send("Network.enable");
if (process.env.AUTH) await send("Network.setExtraHTTPHeaders", { headers: { Authorization: "Basic " + Buffer.from(process.env.AUTH).toString("base64") } });
await send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 2, mobile: true });
if (process.env.THEME) { await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("theme","${process.env.THEME}")` }); }
await send("Page.navigate", { url });
await sleep(3500);
const m = await send("Runtime.evaluate", { expression: "JSON.stringify({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight})", returnByValue: true });
console.log("metrics", m.result.result.value);
const { sh } = JSON.parse(m.result.result.value);
const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: Number(process.env.Y||0), width, height: Number(process.env.H||sh), scale: 1 } });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
ws.close();
proc.kill();
process.exit(0);
