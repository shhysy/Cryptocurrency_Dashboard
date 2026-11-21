import { watchlist } from "@/watchlist.config";
import type { Candle, Trade } from "@/strategy/types";
import type { RawData } from "./dashboard";

/**
 * 示例数据（纯虚构，仅用于没配置 API 时展示页面效果）。
 * 价格走势由「关键点插值 + 带均值回归的噪声」生成，随机种子固定，每次打开形状一致，日期随当前时间平移。
 *
 * 场景（?scenario=xxx）：none 不宜操作 / accumulate 适合买入 / strong 强烈买入 / sell 建议卖出
 */
export type Scenario = "none" | "accumulate" | "strong" | "sell";
export const SCENARIOS: Scenario[] = ["none", "accumulate", "strong", "sell"];
export const DEFAULT_SCENARIO: Scenario = "accumulate";

const WEEK = 7 * 864e5;
const N = 260; // 5 年周线

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type KF = [number, number][]; // [周序号, 归一化价格]

function interp(kf: KF, i: number) {
  for (let k = 1; k < kf.length; k++) {
    if (i <= kf[k][0]) {
      const [x0, y0] = kf[k - 1];
      const [x1, y1] = kf[k];
      const f = (i - x0) / (x1 - x0 || 1);
      return Math.exp(Math.log(y0) + (Math.log(y1) - Math.log(y0)) * f);
    }
  }
  return kf[kf.length - 1][1];
}

function makeWeekly(kf: KF, scale: number, seed: number, vol: number, end: number): Candle[] {
  const r = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
  const out: Candle[] = [];
  let dev = 0;
  let prev = interp(kf, 0) * scale;
  for (let i = 0; i < N; i++) {
    dev = dev * 0.55 + gauss() * vol;
    // 最后一根强制落在关键点上，保证当前价可控
    const close = (i === N - 1 ? interp(kf, i) : interp(kf, i) * Math.exp(dev)) * scale;
    const o = prev;
    out.push({
      t: end - (N - 1 - i) * WEEK,
      o,
      h: Math.max(o, close) * (1 + r() * 0.025),
      l: Math.min(o, close) * (1 - r() * 0.025),
      c: close,
      v: 1000 + r() * 500,
    });
    prev = close;
  }
  return out;
}

// 前 208 周的共同形态（归一化：100 ≈ 起步价）
const HISTORY: KF = [
  [0, 60],
  [50, 110],
  [90, 70],
  [140, 85],
  [180, 140],
  [207, 150],
];

// 各币种最近 52 周的「平静」走势：不触发任何信号
const CALM: Record<string, KF> = {
  BTC: [[208, 150], [226, 172], [245, 160], [259, 166]],
  ETH: [[208, 150], [225, 160], [244, 168], [259, 163]],
  BNB: [[208, 150], [224, 162], [246, 158], [259, 165]],
  UNI: [[208, 150], [226, 158], [246, 150], [259, 154]],
  PAXG: [[208, 150], [230, 160], [248, 168], [259, 172]],
};

// BTC 先跌到 MA200 下方，再在最后一周反弹：RSI 低、价格位置得分高、企稳三项基本满足
const BTC_BOTTOM: KF = [[208, 150], [222, 172], [236, 150], [246, 118], [252, 65], [255, 70], [258, 80], [259, 90]];

// strong：跌得更深，RSI 压到 30 以下，价格位置拿满 45 分
const BTC_DEEP: KF = [[208, 150], [222, 172], [236, 150], [246, 80], [252, 55], [258, 58], [259, 66]];

// 场景里被「点名」的币种走势
const FOCUS: Record<Scenario, Record<string, KF>> = {
  none: {},
  accumulate: { BTC: BTC_BOTTOM },
  strong: { BTC: BTC_DEEP },
  sell: { BNB: [[208, 150], [235, 175], [259, 235]] },
};

// 各场景的恐惧贪婪指数（示例值）：accumulate 情绪偏恐惧，strong 极度恐惧，sell 极度贪婪
const FEAR_GREED: Record<Scenario, number> = { none: 55, accumulate: 25, strong: 10, sell: 85 };

const SCALE: Record<string, number> = { BTC: 400, ETH: 26, BNB: 3.2, UNI: 0.05, PAXG: 14, CL: 0.5 };
const SEED: Record<string, number> = { BTC: 11, ETH: 22, BNB: 44, UNI: 55, PAXG: 77, CL: 88 };
const VOL: Record<string, number> = { BTC: 0.018, ETH: 0.022, BNB: 0.02, UNI: 0.03, PAXG: 0.008, CL: 0.03 };

// 买入周序号（相对 0..259）与每笔金额（USDT）。都放在最近几周：均价接近当前价，平静场景不会误触发止盈
const BUY_WEEKS: Record<string, number[]> = {
  BTC: [235],
  ETH: [240, 250],
  BNB: [238, 248],
  UNI: [242],
  PAXG: [236, 246],
};
const BUY_AMOUNT: Record<string, number> = { BTC: 220, ETH: 180, BNB: 100, UNI: 60, PAXG: 120 };

export function buildMock(scenarioInput?: string, now = Date.now()): { raw: RawData; scenario: Scenario } {
  const scenario = (SCENARIOS as string[]).includes(scenarioInput ?? "") ? (scenarioInput as Scenario) : DEFAULT_SCENARIO;
  const end = Math.floor(now / WEEK) * WEEK - WEEK; // 最近一根完整周线的周一 00:00 UTC；避免示例场景把未收盘周线当成确认信号
  const raw: RawData = { tickers: {}, weekly: {}, trades: [], extraAssets: [{ asset: "USDT", qty: 1200, usdt: 1200 }], fearGreed: FEAR_GREED[scenario], accountKnown: true };
  const r = rng(99);

  for (const w of watchlist) {
    const tail = FOCUS[scenario][w.symbol] ?? CALM[w.symbol] ?? CALM.BTC;
    const kf: KF = [...HISTORY.slice(0, -1), [207, 150], ...tail.slice(1)];
    const weekly = makeWeekly(kf, SCALE[w.symbol] ?? 1, SEED[w.symbol] ?? 7, VOL[w.symbol] ?? 0.02, end);
    raw.weekly[w.symbol] = weekly;

    const last = weekly[weekly.length - 1].c;
    const prevDay = last * (1 + (r() - 0.5) * 0.05);
    raw.tickers[w.symbol] = { price: last, change24h: last / prevDay - 1 };

    (BUY_WEEKS[w.symbol] ?? []).forEach((wk, i) => {
      const c = weekly[wk];
      const price = c.c * (1 + (r() - 0.5) * 0.02);
      const amount = (BUY_AMOUNT[w.symbol] ?? 100) * (0.8 + r() * 0.4);
      const qty = amount / price;
      raw.trades.push({
        id: `mock-${w.symbol}-${wk}`,
        symbol: w.symbol,
 time: c.t + Math.floor(r() * 5 * 864e5) + 3600e3 * 9,
 price,
        qty,
        fee: amount * 0.001,
        source: i < 2 ? "manual" : "binance",
      } satisfies Trade);
    });
  }
  return { raw, scenario };
}
