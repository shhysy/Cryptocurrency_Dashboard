"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";
const KEY = "theme";

/** 白天 / 黑夜切换。首次访问跟随系统设置，手动选择后记住。 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as Theme) || "dark");
  }, []);

  const toggle = () => {
    const next: Theme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // 隐私模式下可能写入失败，本次会话仍然生效
    }
    setTheme(next);
  };

  // 挂载前不渲染文案，避免服务端与客户端文案不一致
  const label = theme === null ? "主题" : theme === "light" ? "☾ 夜间" : "☀ 白天";
  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label="切换白天 / 夜间主题">
      {label}
    </button>
  );
}
