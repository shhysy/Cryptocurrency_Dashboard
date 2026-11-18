type AccessJwk = JsonWebKey & { kid?: string; alg?: string; use?: string };

interface AccessJwks {
  keys: AccessJwk[];
}

export interface CloudflareAccessVerification {
  ok: boolean;
  email?: string;
  reason?: string;
}

let cached: { issuer: string; keys: AccessJwk[]; expiresAt: number } | null = null;

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("JWT Base64URL 编码无效");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function parseSegment<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

function normalizeIssuer(teamDomain: string): string {
  const parsed = new URL(teamDomain);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Cloudflare Access Team Domain 必须是 HTTPS 根域名");
  }
  return parsed.origin;
}

async function loadAccessKeys(issuer: string): Promise<AccessJwk[]> {
  if (cached && cached.issuer === issuer && cached.expiresAt > Date.now()) return cached.keys;
  const response = await fetch(issuer + "/cdn-cgi/access/certs", { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取 Cloudflare Access 公钥");
  const data = await response.json() as AccessJwks;
  if (!Array.isArray(data.keys) || data.keys.length === 0) {
    throw new Error("Cloudflare Access 公钥列表为空");
  }
  cached = { issuer, keys: data.keys, expiresAt: Date.now() + 60 * 60_000 };
  return data.keys;
}

/**
 * Verify the Cloudflare Access JWT injected by the Access-protected hostname.
 * This fails closed unless issuer, audience, signature and expiry all match.
 */
export async function verifyCloudflareAccessJwt(
  token: string | null,
  config: {
    teamDomain: string;
    audience: string;
    allowedEmail?: string;
    nowMs?: number;
  },
): Promise<CloudflareAccessVerification> {
  try {
    if (!token || token.length > 16_384) return { ok: false, reason: "缺少 Cloudflare Access 身份令牌" };
    if (!config.teamDomain || !config.audience) {
      return { ok: false, reason: "Cloudflare Access 服务端验证尚未配置" };
    }
    const issuer = normalizeIssuer(config.teamDomain);
    const parts = token.split(".");
    if (parts.length !== 3) return { ok: false, reason: "Cloudflare Access JWT 格式无效" };
    const header = parseSegment<{ alg?: string; kid?: string }>(parts[0]);
    const claims = parseSegment<{
      iss?: string;
      aud?: string | string[];
      exp?: number;
      nbf?: number;
      iat?: number;
      email?: string;
    }>(parts[1]);
    if (header.alg !== "RS256" || !header.kid) {
      return { ok: false, reason: "Cloudflare Access JWT 签名算法或密钥标识无效" };
    }
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== issuer || !audiences.includes(config.audience)) {
      return { ok: false, reason: "Cloudflare Access JWT issuer 或 audience 不匹配" };
    }
    const now = Math.floor((config.nowMs ?? Date.now()) / 1000);
    if (!Number.isSafeInteger(claims.exp) || claims.exp! <= now ||
        (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now + 30)) ||
        (claims.iat !== undefined && (!Number.isSafeInteger(claims.iat) || claims.iat > now + 60))) {
      return { ok: false, reason: "Cloudflare Access JWT 已过期或尚未生效" };
    }
    if (config.allowedEmail &&
        (typeof claims.email !== "string" ||
         claims.email.toLowerCase() !== config.allowedEmail.toLowerCase())) {
      return { ok: false, reason: "Cloudflare Access 登录邮箱不在允许名单中" };
    }

    const keys = await loadAccessKeys(issuer);
    const jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA");
    if (!jwk) return { ok: false, reason: "Cloudflare Access JWT 公钥不存在" };
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = new TextEncoder().encode(parts[0] + "." + parts[1]);
    const signature = decodeBase64Url(parts[2]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, signed);
    if (!valid) return { ok: false, reason: "Cloudflare Access JWT 签名验证失败" };
    return { ok: true, email: claims.email };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message.slice(0, 180) : "Cloudflare Access 验证失败",
    };
  }
}
