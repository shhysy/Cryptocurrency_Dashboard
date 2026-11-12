export const usd = (n: number, d = 2) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d });

export const num = (n: number, d = 0) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/** 价格按量级自动取小数位：>=1000 取 0 位，>=1 取 2 位，其余取 4 位 */
export const price = (n: number) => usd(n, n >= 1000 ? 0 : n >= 1 ? 2 : 4);

export const pct = (x: number, d = 1, sign = true) =>
  `${sign && x > 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;

export const qty = (n: number) => num(n, n >= 100 ? 2 : n >= 1 ? 3 : 5);

export const date = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const dateTime = (t: number) => {
  const d = new Date(t);
  return `${date(t)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export const tone = (n: number | null | undefined) => (n == null || n === 0 ? "text-mute" : n > 0 ? "text-up" : "text-down");
