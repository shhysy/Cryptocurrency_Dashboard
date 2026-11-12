import type { Candle } from "./types";

/** Wilder RSI。数据不足 period+1 根时返回 null。 */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** 最近 period 根的简单均线，不足返回 null。 */
export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}

/** 把最后一根 K 线的收盘价替换成当前价（最后一根通常未收盘）。 */
export function closesWithPrice(candles: Candle[], price: number): number[] {
  const closes = candles.map((c) => c.c);
  if (closes.length) closes[closes.length - 1] = price;
  return closes;
}

/** 近 lookback 根 K 线的最高价（含当前价）。 */
export function highestHigh(candles: Candle[], lookback: number, price: number): number | null {
  if (!candles.length) return null;
  const slice = candles.slice(-lookback);
  return Math.max(price, ...slice.map((c) => c.h));
}
