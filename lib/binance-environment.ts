export interface BinanceCredentialEnvironment {
  NEXT_PUBLIC_BINANCE_SPOT_TESTNET?: string;
  NEXT_PUBLIC_BINANCE_TESTNET_API_KEY?: string;
  NEXT_PUBLIC_BINANCE_TESTNET_API_SECRET?: string;
  NEXT_PUBLIC_BINANCE_API_KEY?: string;
  NEXT_PUBLIC_BINANCE_API_SECRET?: string;
  fallbackApiKey?: string;
  fallbackApiSecret?: string;
}

export interface ResolvedBinanceSpotEnvironment {
  mode: "testnet" | "production";
  apiBase: string;
  apiKey: string;
  apiSecret: string;
}

/**
 * Testnet is an isolated credential domain: it never falls back to production
 * credentials, even when testnet credentials are missing.
 */
export function resolveBinanceSpotEnvironment(
  env: BinanceCredentialEnvironment,
): ResolvedBinanceSpotEnvironment {
  if (env.NEXT_PUBLIC_BINANCE_SPOT_TESTNET === "1") {
    return {
      mode: "testnet",
      apiBase: "https://testnet.binance.vision",
      apiKey: env.NEXT_PUBLIC_BINANCE_TESTNET_API_KEY ?? "",
      apiSecret: env.NEXT_PUBLIC_BINANCE_TESTNET_API_SECRET ?? "",
    };
  }
  return {
    mode: "production",
    apiBase: "https://api.binance.com",
    apiKey: env.NEXT_PUBLIC_BINANCE_API_KEY || env.fallbackApiKey || "",
    apiSecret: env.NEXT_PUBLIC_BINANCE_API_SECRET || env.fallbackApiSecret || "",
  };
}

export function assertSimpleEarnSupported(mode: "testnet" | "production"): void {
  if (mode === "testnet") {
    throw new Error("Binance Spot Testnet 不支持 Simple Earn；已阻止访问生产理财接口");
  }
}

export interface BinanceSpotSubmissionEnvironment {
  NEXT_PUBLIC_BINANCE_SPOT_TESTNET_BUY_ENABLED?: string;
  NEXT_PUBLIC_BINANCE_SPOT_TESTNET_SELL_ENABLED?: string;
}

/** Production submission remains hard-disabled; explicit opt-ins are testnet-only. */
export function resolveBinanceSpotSubmissionSwitches(
  mode: "testnet" | "production",
  env: BinanceSpotSubmissionEnvironment,
): { buyEnabled: boolean; sellEnabled: boolean } {
  if (mode !== "testnet") return { buyEnabled: false, sellEnabled: false };
  return {
    buyEnabled: env.NEXT_PUBLIC_BINANCE_SPOT_TESTNET_BUY_ENABLED === "1",
    sellEnabled: env.NEXT_PUBLIC_BINANCE_SPOT_TESTNET_SELL_ENABLED === "1",
  };
}

export interface ServerBinanceEnvironment {
  BINANCE_SPOT_ENVIRONMENT?: string;
  BINANCE_TESTNET_API_KEY?: string;
  BINANCE_TESTNET_API_SECRET?: string;
  BINANCE_API_KEY?: string;
  BINANCE_API_SECRET?: string;
  BINANCE_BASE_URL?: string;
}

export function resolveServerBinanceEnvironment(env: ServerBinanceEnvironment) {
  if (env.BINANCE_SPOT_ENVIRONMENT !== undefined &&
      env.BINANCE_SPOT_ENVIRONMENT !== "testnet" &&
      env.BINANCE_SPOT_ENVIRONMENT !== "production") {
    throw new Error("BINANCE_SPOT_ENVIRONMENT 只能是 testnet 或 production；已拒绝启动 Binance 服务");
  }
  if (env.BINANCE_SPOT_ENVIRONMENT === "testnet") {
    return {
      mode: "testnet" as const,
      apiBase: "https://testnet.binance.vision",
      apiKey: env.BINANCE_TESTNET_API_KEY ?? "",
      apiSecret: env.BINANCE_TESTNET_API_SECRET ?? "",
    };
  }
  return {
    mode: "production" as const,
    apiBase: env.BINANCE_BASE_URL || "https://api.binance.com",
    apiKey: env.BINANCE_API_KEY ?? "",
    apiSecret: env.BINANCE_API_SECRET ?? "",
  };
}

export function isTestnetOrderSubmissionEnabled(
  mode: "testnet" | "production",
  side: "BUY" | "SELL",
  env: { BINANCE_TESTNET_BUY_ENABLED?: string; BINANCE_TESTNET_SELL_ENABLED?: string },
): boolean {
  if (mode !== "testnet") return false;
  return side === "BUY"
    ? env.BINANCE_TESTNET_BUY_ENABLED === "1"
    : env.BINANCE_TESTNET_SELL_ENABLED === "1";
}
