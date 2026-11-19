import type { PrepOrderRow, PrepPlan } from "./prep-orders";

const columns: (keyof PrepOrderRow)[] = [
  "id",
  "symbol",
  "side",
  "kind",
  "label",
  "tierIndex",
  "triggerPrice",
  "triggerRule",
  "plannedUsdt",
  "sellRatioOfCycle",
  "status",
  "anchor",
  "headPrice",
  "avgCost",
  "note",
  "updatedAt",
];

function csvCell(value: unknown): string {
  let raw = value == null ? "" : String(value);
  if (/^[=+\-@\t\r\n]/.test(raw)) raw = "'" + raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

export function prepPlanToCsv(plan: PrepPlan): string {
  const header = ["planKind", "phase", "group", ...columns].join(",");
  const lines = plan.orders.map((row) =>
    [plan.planKind ?? "manual_prep", plan.phase, plan.group, ...columns.map((key) => csvCell(row[key]))].join(","),
  );
  return [header, ...lines].join("\r\n");
}

export function downloadPrepPlanCsv(plan: PrepPlan, filename?: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("CSV 下载只能在浏览器中执行");
  }
  const name =
    filename ||
    `预备订单_${plan.symbol}_${plan.phase}_${new Date(plan.generatedAt).toISOString().slice(0, 10)}.csv`;
  const blob = new Blob(["\uFEFF", prepPlanToCsv(plan)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function prepPlansToCsv(plans: PrepPlan[]): string {
  if (!plans.length) return "planKind,phase,group," + columns.join(",");
  return plans.map(prepPlanToCsv).join("\r\n\r\n");
}
