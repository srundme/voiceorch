import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme-provider";

export interface ChartTheme {
  tickColor: string;
  gridColor: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  tooltipShadow: string;
  palette: {
    completed: string;
    failed: string;
    inProgress: string;
    pending: string;
  };
}

function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return prefersDark;
}

export function useChartTheme(): ChartTheme {
  const { theme } = useTheme();
  const prefersDark = usePrefersDark();
  const isDark = theme === "dark" || (theme === "system" && prefersDark);

  return {
    tickColor:     isDark ? "hsl(0,0%,55%)"  : "#9CA3AF",
    gridColor:     isDark ? "rgba(255,255,255,0.06)" : "#F3F4F6",
    tooltipBg:     isDark ? "hsl(0,0%,8%)"   : "#FFFFFF",
    tooltipBorder: isDark ? "hsl(0,0%,14%)"  : "#E5E7EB",
    tooltipText:   isDark ? "hsl(0,0%,96%)"  : "#111827",
    tooltipShadow: isDark
      ? "0 4px 16px rgba(0,0,0,0.6)"
      : "0 4px 12px rgba(0,0,0,0.08)",
    palette: {
      completed: isDark ? "#22c55e" : "#374151",
      failed:    "#EF4444",
      inProgress: "#F59E0B",
      pending:   "#6b7280",
    },
  };
}
