import { cn } from "@/lib/utils";

interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
  /** Inner max-width. Defaults to "max-w-7xl". */
  maxWidth?: "max-w-3xl" | "max-w-4xl" | "max-w-5xl" | "max-w-6xl" | "max-w-7xl" | "max-w-none";
}

/**
 * Shared wrapper for authenticated app pages.
 * Provides a consistent max-width, horizontal gutters and vertical
 * spacing so all interior pages align on the same grid.
 */
export function PageContainer({
  children,
  className,
  maxWidth = "max-w-7xl",
}: PageContainerProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className={cn("mx-auto w-full px-6 py-8 md:px-8 space-y-6", maxWidth, className)}>
        {children}
      </div>
    </div>
  );
}
