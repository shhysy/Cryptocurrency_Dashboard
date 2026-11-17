"use client";

/** 机会指数进度条：视觉上快速判断离买入门槛还有多远。 */
export function ScoreBar({ score, group, max = 90 }: { score: number; group: "core" | "alt"; max?: number }) {
  const threshold = group === "core" ? 55 : 75;
  const pctVal = Math.min(100, (score / max) * 100);
  const thresholdPct = (threshold / max) * 100;
  const ready = score >= threshold;
  return (
    <div className="mt-1.5">
      <div className="relative h-1.5 overflow-hidden rounded-full bg-track">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pctVal}%`,
            background: ready
              ? "linear-gradient(90deg, var(--c-up), var(--c-gold))"
              : "linear-gradient(90deg, var(--c-calm), var(--c-sub))",
          }}
        />
        <i
          className="absolute top-0 h-full w-0.5 bg-gold/80"
          style={{ left: `${thresholdPct}%` }}
          title={`${group === "core" ? "积极型" : "保守型"}门槛 ${threshold}`}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-mute">
        <span>0</span>
        <span className={ready ? "font-medium text-up" : ""}>
          门槛 {threshold}
          {ready ? " ✓" : ""}
        </span>
        <span>{max}</span>
      </div>
    </div>
  );
}
