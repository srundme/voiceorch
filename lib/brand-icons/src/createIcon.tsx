import type { ReactNode, SVGProps } from "react";

/** Brand opacity cascade — mirrors the three-bar mark + agent ear pads. */
export const O = {
  full: 1,
  mid: 0.55,
  soft: 0.36,
} as const;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** Bounding box in px. CSS size-* classes still override when present. */
  size?: number | string;
}

type IconBody = (props: { o: typeof O }) => ReactNode;

/**
 * Factory for soft-fill SnapServe nav marks.
 * Lucide-compatible: accepts `className` + optional `size`, uses `currentColor`.
 */
export function createIcon(displayName: string, body: IconBody) {
  function Icon({ size = 24, className, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden
        focusable="false"
        {...props}
      >
        {body({ o: O })}
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}
