/**
 * 执行日志脱敏：禁止输出 Key/Secret/签名原文。
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

export function safeLog(message: string, ...rest: unknown[]): void {
  const parts = [message, ...rest.map((item) => {
    if (typeof item === "string") return redactSecrets(item);
    try {
      return redactSecrets(JSON.stringify(item));
    } catch {
      return "[unserializable]";
    }
  })];
  console.log(redactSecrets(parts.join(" ")));
}

export function safeError(message: string, error?: unknown): void {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  console.error(redactSecrets(`${message} ${detail}`.trim()));
}
