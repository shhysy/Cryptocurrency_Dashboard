import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 执行日志脱敏：禁止输出Key/Secret/签名原文。
 * 文件按UTC日期分片，默认写入data/logs/trader-YYYY-MM-DD.log。
 */
const SENSITIVE =
  /((?:api[_-]?key|api[_-]?secret|secret|signature|authorization|hmac|password|token)\s*[=:]\s*)(["']?)([^\s"',;]+)\2/gi;
const HEXISH = /\b[a-fA-F0-9]{32,}\b/g;

export function redactSecrets(text: string): string {
  let out = String(text ?? "");
  out = out.replace(SENSITIVE, (_, prefix: string, quote: string) => `${prefix}${quote}***${quote}`);
  out = out.replace(HEXISH, (match) => (match.length >= 40 ? "***" : match));
  return out;
}

function appendDailyLog(level: "INFO" | "ERROR", line: string): void {
  try {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const directory = process.env.TRADER_LOG_DIR || join(process.cwd(), "data", "logs");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `trader-${day}.log`);
    appendFileSync(path, `${now.toISOString()} [${level}] ${line}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    // Logging failure must not hide the original trading result; console remains a fallback.
    console.error("[Trader] 执行日志落盘失败", error instanceof Error ? redactSecrets(error.message) : "未知错误");
  }
}

export function safeLog(message: string, ...rest: unknown[]): void {
  const parts = [message, ...rest.map((item) => {
    if (typeof item === "string") return redactSecrets(item);
    try {
      return redactSecrets(JSON.stringify(item));
    } catch {
      return "[unserializable]";
    }
  })];
  const line = redactSecrets(parts.join(" "));
  console.log(line);
  appendDailyLog("INFO", line);
}

export function safeError(message: string, error?: unknown): void {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  const line = redactSecrets(`${message} ${detail}`.trim());
  console.error(line);
  appendDailyLog("ERROR", line);
}
