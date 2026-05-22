const FONT = "'Tex Gyre Heros', 'Helvetica Neue', Helvetica, Arial, sans-serif";

interface Props {
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
}

const sizes: Record<NonNullable<Props["size"]>, string> = {
  xs: "text-xs",
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
};

export function SnapServeLogo({ className = "", size = "sm" }: Props) {
  return (
    <span
      className={`${sizes[size]} leading-none select-none ${className}`}
      style={{ fontFamily: FONT }}
    >
      <span style={{ fontWeight: 700 }}>Snap</span>
      <span style={{ fontWeight: 400 }}>Serve</span>
    </span>
  );
}
