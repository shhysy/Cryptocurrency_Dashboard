"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** 数字滚动：值变化时从旧值缓动到新值。首次挂载从 0 开始。 */
export function CountUp({ value, format, duration = 1100 }: { value: number; format: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - p, 4);
      const v = a + (value - a) * e;
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="num">{format(shown)}</span>;
}

/** 数值变化时返回 flash-up / flash-down，用于价格闪绿闪红。 */
export function useFlash(value: number) {
  const prev = useRef(value);
  const [cls, setCls] = useState("");
  useEffect(() => {
    if (value !== prev.current) {
      setCls(value > prev.current ? "flash-up" : "flash-down");
      prev.current = value;
      const t = setTimeout(() => setCls(""), 950);
      return () => clearTimeout(t);
    }
  }, [value]);
  return cls;
}

/** 容器宽度（ResizeObserver）。 */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const [ref, w] = useSize<T>();
  return [ref, w];
}

/** 容器宽高（ResizeObserver）。图表用它跟随容器大小。 */
export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, number, number] {
  const ref = useRef<T | null>(null);
  const [s, setS] = useState({ w: 0, h: 0 });
  useIso(() => {
    const el = ref.current;
    if (!el) return;
    setS({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(([e]) => setS({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, s.w, s.h];
}

/** 一屏模式：桌面宽度且高度足够。与 globals.css 里的 fit 变体使用同一条件。 */
const FIT_QUERY = "(min-width: 1024px) and (min-height: 760px)";
export function useFit() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(FIT_QUERY);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(FIT_QUERY).matches,
    () => false,
  );
}
