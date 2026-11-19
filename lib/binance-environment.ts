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
