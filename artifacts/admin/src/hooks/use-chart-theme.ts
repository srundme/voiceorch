import { useTheme } from "@/components/theme-provider";

export interface AdminChartTheme {
  tickColor: string;
  gridColor: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  tooltipShadow: string;
  serviceColors: {
    stt: string;
    llm: string;
    tts: string;
  };
  pieColors: string[];
}

function resolveIsDark(theme: string): boolean {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return theme === "dark";
}

export function useChartTheme(): AdminChartTheme {
  const { theme } = useTheme();
  const isDark = resolveIsDark(theme);

  return {
    tickColor:     isDark ? "hsl(0,0%,55%)"            : "#9CA3AF",
    gridColor:     isDark ? "rgba(255,255,255,0.06)"   : "#F3F4F6",
    tooltipBg:     isDark ? "hsl(0,0%,8%)"             : "#FFFFFF",
    tooltipBorder: isDark ? "hsl(0,0%,14%)"            : "#E5E7EB",
    tooltipText:   isDark ? "hsl(0,0%,96%)"            : "#111827",
    tooltipShadow: isDark
      ? "0 4px 16px rgba(0,0,0,0.6)"
      : "0 4px 12px rgba(0,0,0,0.08)",
    serviceColors: {
      stt: isDark ? "#818cf8" : "#4f46e5",
      llm: isDark ? "#a78bfa" : "#7c3aed",
      tts: isDark ? "#22d3ee" : "#0891b2",
    },
    pieColors: isDark
      ? ["#818cf8", "#a78bfa", "#22d3ee", "#34d399", "#fbbf24", "#f87171", "#fb7185", "#2dd4bf"]
      : ["#4f46e5", "#7c3aed", "#0891b2", "#059669", "#d97706", "#dc2626", "#db2777", "#0d9488"],
  };
}
