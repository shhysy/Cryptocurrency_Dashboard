/**
 * Wallet separation model.
 *
 * Only Spot free USDT is executable for a Spot market buy. Earn and Funding
 * balances are displayed separately and must never be silently added to it.
 */
export interface UsdtWalletBuckets {
  spotFreeUsdt: number;
  spotLockedUsdt: number;
  flexibleEarnUsdt: number;
  lockedEarnUsdt: number;
  fundingUsdt: number;
  otherWalletUsdt: number;
  activeBuyReservationsUsdt: number;
}

export interface UsdtWalletSummary extends UsdtWalletBuckets {
  totalTrackedUsdt: number;
  spotExecutableBeforeReservationsUsdt: number;
  spotExecutableAfterReservationsUsdt: number;
  nonSpotUsdt: number;
}

export function summarizeUsdtWallets(input: UsdtWalletBuckets): UsdtWalletSummary {
  const values = Object.values(input);
  if (!values.every(Number.isFinite) || values.some((value) => value < 0)) {
    throw new Error("USDT 账户分层余额必须是非负有限数值");
  }
  const spotExecutableBeforeReservationsUsdt = input.spotFreeUsdt;
  const spotExecutableAfterReservationsUsdt = Math.max(
    0,
    input.spotFreeUsdt - input.activeBuyReservationsUsdt,
  );
  const nonSpotUsdt = input.flexibleEarnUsdt + input.lockedEarnUsdt +
    input.fundingUsdt + input.otherWalletUsdt;
  return {
    ...input,
    totalTrackedUsdt: input.spotFreeUsdt + input.spotLockedUsdt + nonSpotUsdt,
    spotExecutableBeforeReservationsUsdt,
    spotExecutableAfterReservationsUsdt,
    nonSpotUsdt,
  };
}

/**
 * Convert a Spot account response into explicitly separated Spot USDT and
 * legacy LDUSDT flexible-Earn voucher amounts. LDUSDT is not Spot free USDT.
 */
export function splitSpotAccountUsdtBalances(
  balances: Array<{ asset: string; free: string; locked: string }>,
): Pick<UsdtWalletBuckets, "spotFreeUsdt" | "spotLockedUsdt" | "flexibleEarnUsdt"> {
  const parse = (value: string, label: string) => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`Binance ${label} 余额无效`);
    return amount;
  };
  const spot = balances.find((item) => item.asset === "USDT");
  const earn = balances.find((item) => item.asset === "LDUSDT");
  return {
    spotFreeUsdt: parse(spot?.free ?? "0", "Spot USDT free"),
    spotLockedUsdt: parse(spot?.locked ?? "0", "Spot USDT locked"),
    flexibleEarnUsdt: parse(earn?.free ?? "0", "LDUSDT flexible Earn free") +\n      parse(earn?.locked ?? "0", "LDUSDT flexible Earn locked"),
  };
}
