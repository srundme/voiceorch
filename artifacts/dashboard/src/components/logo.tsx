/* ── SnapServe brand components ────────────────────────────────────────────
   SnapServeIcon   — the three-bar mark (SVG, inline, scalable)
   SnapServeLogo   — icon + wordmark  ("Snap" Bold / "Serve" Regular)
   SnapServeLoader — full-screen splash with animated bars
   SnapServeSarvamLockup — official “SnapServe powered by sarvam” image
   PoweredBySarvam — family co-brand (SnapServe stays primary)
   ─────────────────────────────────────────────────────────────────────────*/

const FONT = "'Tex Gyre Heros', Helvetica, Arial, sans-serif";
const LOCKUP_SRC = "snapserve-powered-by-sarvam.png";

/* ── BrandMark (image-based lockup, mirrors admin) ----------------------- */

interface BrandMarkProps {
  /** Pixel size of the icon (height & width). */
  iconSize?: number;
  /** Pixel height of the wordmark image. */
  wordmarkHeight?: number;
  /** Tailwind gap class between icon and wordmark. */
  gapClass?: string;
  className?: string;
}

export function BrandMark({
  iconSize = 20,
  wordmarkHeight = 14,
  gapClass = "gap-1.5",
  className = "",
}: BrandMarkProps) {
  return (
    <span className={`inline-flex items-center select-none ${gapClass} ${className}`}>
      <img
        src={`${import.meta.env.BASE_URL}snapserve-icon-light.png`}
        alt=""
        aria-hidden
        width={iconSize}
        height={iconSize}
        style={{ width: iconSize, height: iconSize }}
        className="shrink-0"
      />
      <img
        src={`${import.meta.env.BASE_URL}snapserve-wordmark-light.png`}
        alt="SnapServe"
        style={{ height: wordmarkHeight }}
        className="shrink-0"
      />
    </span>
  );
}

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

/* ── Official co-brand lockup image ─────────────────────────────────────── */

interface SnapServeSarvamLockupProps {
  /** Pixel height of the lockup (aspect ~202×32). */
  height?: number;
  /**
   * Asset is white text (for dark UIs). Pass `light` to invert for light backgrounds
   * via CSS filter so we keep a single source PNG.
   */
  on?: "dark" | "light";
  className?: string;
}

/** Official “SnapServe powered by sarvam” lockup (product first, Sarvam second). */
export function SnapServeSarvamLockup({
  height = 20,
  on = "dark",
  className = "",
}: SnapServeSarvamLockupProps) {
  const width = Math.round((height * 202) / 32);
  return (
    <img
      src={`${import.meta.env.BASE_URL}${LOCKUP_SRC}`}
      alt="SnapServe powered by Sarvam"
      width={width}
      height={height}
      style={{ height, width: "auto" }}
      className={`select-none ${on === "light" ? "invert" : ""} ${className}`}
      draggable={false}
    />
  );
}

/* ── Loader --------------------------------------------------------------- */

export function SnapServeLoader() {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{
        background: "#000",
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

      <div className="flex flex-col items-center gap-1.5">
        <span
          className="leading-none text-[15px] text-white"
          style={{ fontFamily: "system-ui, sans-serif", letterSpacing: "-0.02em" }}
        >
          <span style={{ fontWeight: 700 }}>Snap</span>
          <span style={{ fontWeight: 400, opacity: 0.55 }}>Serve</span>
        </span>
        <PoweredBySarvam variant="inline" className="text-white/50 [&_span]:text-white/50" />
      </div>

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

/* ── Powered by Sarvam (family co-brand) ───────────────────────────────── */

type PoweredBySarvamVariant = "footer" | "inline" | "lockup";

interface PoweredBySarvamProps {
  /** footer = public page footer; inline = under BrandMark; lockup = full official image */
  variant?: PoweredBySarvamVariant;
  className?: string;
  /** When true, show the official SnapServe + Sarvam lockup image. */
  includeSnapServe?: boolean;
  /** Background the lockup sits on — drives invert for light pages. */
  on?: "dark" | "light";
}

/**
 * Family co-brand line — text only. SnapServe stays the product mark elsewhere;
 * this is always “powered by sarvam” (no Sarvam logo asset).
 */
export function PoweredBySarvam({
  variant = "footer",
  className = "",
  includeSnapServe: _includeSnapServe = false,
  on: _on = "light",
}: PoweredBySarvamProps) {
  const sizeClass =
    variant === "inline" ? "text-[9px]" : "text-[10px]";
  const gapClass = variant === "inline" ? "gap-1" : "gap-1";

  return (
    <p
      className={`inline-flex items-center ${gapClass} ${sizeClass} text-muted-foreground select-none tracking-wide ${className}`}
    >
      <span className="font-normal opacity-70">powered by</span>
      <span className="font-medium text-muted-foreground">sarvam</span>
    </p>
  );
}
