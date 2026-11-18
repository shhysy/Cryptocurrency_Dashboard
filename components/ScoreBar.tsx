"use client";

/** 机会指数进度条；阈值来自 strategy.config。 */
export function ScoreBar({ score, group, max = 100 }: { score: number; group: "core" | "alt"; max?: number }) {
  const pct = Math.min(100, Math.max(0, (score / max) * 100));
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-track">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{
          width: `${pct}%`,
          background:
            score >= (group === "core" ? 61 : 83)
              ? "linear-gradient(90deg, var(--c-up), var(--c-gold))"
              : "linear-gradient(90deg, var(--c-calm), var(--c-sub))",
        }}
      />
    </div>
  );
}
