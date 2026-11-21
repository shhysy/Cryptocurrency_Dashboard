import { mkdir, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  hasCredentials,
  getServerBinanceSpotMode,
  fetchBinanceServerTime,
  fetchSignedBinanceRead,
} from "@/lib/binance";
import type { AutoTradeMode } from "./auto-trade-mode";

export interface SelfCheckResult {
  ok: boolean;
  reasons: string[];
}

interface BinanceAccountPermissionSnapshot {
  canTrade?: boolean;
  canWithdraw?: boolean;
  balances?: Array<{ asset: string; free: string; locked: string }>;
}

async function checkWritableDirectory(directory: string, label: string, reasons: string[]): Promise<void> {
  try {
    await mkdir(directory, { recursive: true });
    const probe = join(directory, `.write-probe-${process.pid}-${Date.now()}`);
    await writeFile(probe, "ok", { encoding: "utf8", flag: "wx", mode: 0o600 });
    await unlink(probe);
  } catch {
    reasons.push(`${label}不可写：${directory}`);
  }
}

/**
 * 启动自检：live/testnet 模式必须真实读取账户权限、余额和服务器时间。
 * 任一关键数据缺失、权限不安全或网络失败时拒绝启动。
 */
export async function runStartupSelfCheck(input: {
  mode: AutoTradeMode;
  dbPath?: string;
  dataDir?: string;
}): Promise<SelfCheckResult> {
  const reasons: string[] = [];
  const dataDir = input.dataDir ?? "data";
  const dbPath = input.dbPath ?? "data/trader.db";

  await checkWritableDirectory(dataDir, "数据目录", reasons);
  await checkWritableDirectory(dirname(dbPath), "SQLite数据库目录", reasons);

  if (input.mode === "testnet" || input.mode === "production") {
    if (!hasCredentials()) {
      reasons.push("未配置可用的 Binance API Key/Secret");
      return { ok: false, reasons };
    }
    const expectedMode = input.mode;
    if (getServerBinanceSpotMode() !== expectedMode) {
      reasons.push(input.mode === "testnet"
        ? "AUTO_TRADE_MODE=testnet 时 BINANCE_SPOT_ENVIRONMENT 必须为 testnet"
        : "AUTO_TRADE_MODE=production 时 BINANCE_SPOT_ENVIRONMENT 必须为 production");
      return { ok: false, reasons };
    }
    if (input.mode === "production" && process.env.BINANCE_WITHDRAW_ENABLED === "1") {
      reasons.push("检测到 BINANCE_WITHDRAW_ENABLED=1；生产禁止启用提现权限");
    }

    try {
      const [account, clock] = await Promise.all([
        fetchSignedBinanceRead<BinanceAccountPermissionSnapshot>("/api/v3/account", {
          omitZeroBalances: "false",
        }),
        fetchBinanceServerTime(),
      ]);

      if (!account || typeof account.canTrade !== "boolean" || typeof account.canWithdraw !== "boolean") {
        reasons.push("Binance账户权限响应缺少 canTrade/canWithdraw，拒绝启动");
      } else {
        if (!account.canTrade) reasons.push("Binance API Key 未启用现货交易权限");
        if (account.canWithdraw) reasons.push("Binance API Key 开启了提现权限；必须关闭后才能启动");
      }

      if (!Array.isArray(account?.balances)) {
        reasons.push("Binance账户响应缺少余额列表");
      } else {
        const usdt = account.balances.find((item) => item.asset === "USDT");
        const free = Number(usdt?.free);
        const locked = Number(usdt?.locked);
        if (!usdt || !Number.isFinite(free) || !Number.isFinite(locked) || free < 0 || locked < 0) {
          reasons.push("无法读取有效的USDT可用/冻结余额；拒绝启动");
        }
      }

      const configuredSkew = process.env.TRADER_MAX_CLOCK_SKEW_MS;
      const maxSkew = configuredSkew === undefined ? 5_000 : Number(configuredSkew);
      if (!Number.isFinite(maxSkew) || maxSkew < 0 || maxSkew > 60_000) {
        reasons.push("TRADER_MAX_CLOCK_SKEW_MS必须在0至60000毫秒之间");
      } else {
        const skew = Math.abs(clock.serverTime - clock.localMidpoint);
        if (!Number.isFinite(clock.roundTripMs) || clock.roundTripMs < 0 || clock.roundTripMs > 10_000) {
          reasons.push("Binance服务器时间探测网络延迟过高，拒绝启动");
        }
        if (skew > maxSkew) {
          reasons.push(`本机与Binance服务器时间偏差${Math.round(skew)}ms，超过允许值${maxSkew}ms`);
        }
      }
    } catch (error) {
      reasons.push(`Binance账户/时间自检失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}
