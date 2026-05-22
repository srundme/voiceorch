/* ── SnapServe brand components ────────────────────────────────────────────
   SnapServeIcon   — the three-bar mark (SVG, inline, scalable)
   SnapServeLogo   — icon + wordmark  ("Snap" Bold / "Serve" Regular)
   SnapServeLoader — full-screen splash with animated bars
   ─────────────────────────────────────────────────────────────────────────*/

const FONT = "'Tex Gyre Heros', 'Helvetica Neue', Helvetica, Arial, sans-serif";

/* ── Icon ----------------------------------------------------------------- */

interface IconProps {
  className?: string;
  /** px size of the bounding box — bars scale with it */
  size?: number;
}

export function SnapServeIcon({ size = 24, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="SnapServe"
    >
      <rect x="6"  y="14" width="88" height="20" rx="10" fill="currentColor" opacity="1"   />
      <rect x="14" y="42" width="72" height="20" rx="10" fill="currentColor" opacity="0.60"/>
      <rect x="22" y="70" width="56" height="20" rx="10" fill="currentColor" opacity="0.36"/>
    </svg>
  );
}

/* ── Wordmark ------------------------------------------------------------- */

interface LogoProps {
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
  /** show the icon mark alongside the wordmark */
  showIcon?: boolean;
  iconSize?: number;
}

const sizes: Record<NonNullable<LogoProps["size"]>, string> = {
  xs: "text-xs",
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
};

export function SnapServeLogo({
  className = "",
  size = "sm",
  showIcon = false,
  iconSize = 18,
}: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 leading-none select-none ${className}`}>
      {showIcon && <SnapServeIcon size={iconSize} className="shrink-0" />}
      <span style={{ fontFamily: FONT }}>
        <span style={{ fontWeight: 700 }} className={sizes[size]}>Snap</span>
        <span style={{ fontWeight: 400 }} className={sizes[size]}>Serve</span>
      </span>
    </span>
  );
}

/* ── Loader --------------------------------------------------------------- */

export function SnapServeLoader() {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{
        background: "linear-gradient(140deg, #cfd8f0 0%, #d8dcf0 18%, #e0e4f4 35%, #dde6f2 52%, #d5dced 70%, #cfd9ef 85%, #d8dff2 100%)",
      }}
    >
      {/* Animated three-bar icon */}
      <div className="flex flex-col gap-2.5 mb-6" style={{ width: 56 }}>
        {[
          { width: "100%", opacity: 1,    delay: "0ms"   },
          { width: "82%",  opacity: 0.62, delay: "120ms" },
          { width: "64%",  opacity: 0.38, delay: "240ms" },
        ].map((bar, i) => (
          <div
            key={i}
            style={{
              width: bar.width,
              height: 12,
              borderRadius: 6,
              backgroundColor: "#111",
              opacity: bar.opacity,
              animation: `ss-bar-pulse 1.2s ease-in-out infinite`,
              animationDelay: bar.delay,
            }}
          />
        ))}
      </div>

      {/* Wordmark */}
      <span
        style={{ fontFamily: FONT, fontSize: 18, color: "#1a1a2e", letterSpacing: "-0.01em" }}
        className="select-none"
      >
        <span style={{ fontWeight: 700 }}>Snap</span>
        <span style={{ fontWeight: 400 }}>Serve</span>
      </span>

      <style>{`
        @keyframes ss-bar-pulse {
          0%   { transform: scaleX(1);    opacity: var(--bar-op, 1); }
          40%  { transform: scaleX(0.88); opacity: calc(var(--bar-op, 1) * 0.5); }
          70%  { transform: scaleX(1);    opacity: var(--bar-op, 1); }
          100% { transform: scaleX(1);    opacity: var(--bar-op, 1); }
        }
      `}</style>
    </div>
  );
}
