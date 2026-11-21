export type AutoTradeMode = "off" | "dry-run" | "testnet" | "production";

export function parseAutoTradeMode(raw: string | undefined): AutoTradeMode {
  const value = raw ?? "off";
  if (value !== "off" && value !== "dry-run" && value !== "testnet" && value !== "production") {
    throw new Error("AUTO_TRADE_MODE只允许off、dry-run、testnet、production");
  }
  return value;
}

/** production 必须同时满足显式确认变量；否则拒绝。 */
export function assertProductionAuthorized(env: NodeJS.ProcessEnv = process.env): void {
  if ((env.AUTO_TRADE_MODE ?? "off") !== "production") return;
  if (env.I_UNDERSTAND_LIVE_TRADING !== "yes") {
    throw new Error("生产模式需要 I_UNDERSTAND_LIVE_TRADING=yes；当前拒绝启动");
  }
}
