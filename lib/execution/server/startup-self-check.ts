import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { hasCredentials, getServerBinanceSpotMode } from "@/lib/binance";
import type { AutoTradeMode } from "./auto-trade-mode";

export interface SelfCheckResult {
  ok: boolean;
  reasons: string[];
}

/**
 * 启动自检：失败时拒绝启动并给出中文原因。
 */
export async function runStartupSelfCheck(input: {
  mode: AutoTradeMode;
  dbPath?: string;
  dataDir?: string;
}): Promise<SelfCheckResult> {
  const reasons: string[] = [];
  const dataDir = input.dataDir ?? "data";

  try {
    await mkdir(dataDir, { recursive: true });
    const probe = join(dataDir, `.write-probe-${process.pid}`);
    await writeFile(probe, "ok", "utf8");
    await unlink(probe);
  } catch {
    reasons.push(`数据目录不可写：${dataDir}`);
  }

  if (input.mode === "testnet" || input.mode === "production") {
    if (!hasCredentials()) reasons.push("未配置可用的 Binance API Key/Secret");
    if (input.mode === "testnet" && getServerBinanceSpotMode() !== "testnet") {
      reasons.push("AUTO_TRADE_MODE=testnet 时 BINANCE_SPOT_ENVIRONMENT 必须为 testnet");
    }
    if (input.mode === "production" && getServerBinanceSpotMode() === "testnet") {
      reasons.push("生产模式不能使用 testnet 环境变量");
    }
    if (input.mode === "production" && process.env.BINANCE_WITHDRAW_ENABLED === "1") {
      reasons.push("检测到 BINANCE_WITHDRAW_ENABLED=1；生产禁止启用提现权限");
    }
  }

  const skewEnv = process.env.TRADER_MAX_CLOCK_SKEW_MS;
  if (skewEnv) {
    const skew = Number(skewEnv);
    if (!Number.isFinite(skew) || skew < 0 || skew > 60_000) {
      reasons.push("TRADER_MAX_CLOCK_SKEW_MS 配置无效");
    }
  }

  return { ok: reasons.length === 0, reasons };
}
