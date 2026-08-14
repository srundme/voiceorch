import { useId } from "react";

/* ── SnapServe brand components ────────────────────────────────────────────
   SnapServeIcon   — the three-bar mark (SVG, inline, scalable)
   SnapServeAgentIcon — the Headset agent mark (friendly face + brand bar)
   SnapServeLogo   — icon + wordmark  ("Snap" Bold / "Serve" Regular)
   SnapServeLoader — full-screen splash with animated bars
   ─────────────────────────────────────────────────────────────────────────*/

const FONT = "'Tex Gyre Heros', Helvetica, Arial, sans-serif";

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

/* ── Agent bot mark -------------------------------------------------------- */

/**
 * SnapServeAgentIcon — the Headset agent mark.
 *
 * A friendly voice-agent face: a tall rounded head with wide-set eyes and a
 * smile, flanked by headset ear pads and resting on a single SnapServe brand
 * bar. The face is knocked out through a mask so the whole mark stays a single
 * `currentColor` shape, keeping it crisp in sidebar active/inactive states and
 * at the 16–20 px navigation sizes.
 */
export function SnapServeAgentIcon({ size = 24, className = "" }: IconProps) {
  // useId can emit colons, which break `url(#…)` references in some browsers.
  const maskId = `ss-agent-${useId().replace(/:/g, "")}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="SnapServe agent"
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="black" />
        <rect x="4.3" y="3.2" width="15.4" height="14" rx="6" fill="white" />
        <circle cx="9.3" cy="9" r="1.9" fill="black" />
        <circle cx="14.7" cy="9" r="1.9" fill="black" />
        <path
          d="M9.9 12.8c.945 1.68 3.255 1.68 4.2 0"
          stroke="black"
          strokeWidth="1.35"
          strokeLinecap="round"
          fill="none"
        />
      </mask>

      {/* headset ear pads */}
      <rect x="1.1" y="7.9" width="3" height="6.4" rx="1.5" fill="currentColor" opacity="0.55" />
      <rect x="19.9" y="7.9" width="3" height="6.4" rx="1.5" fill="currentColor" opacity="0.55" />

      {/* head with the face punched out */}
      <rect width="24" height="24" fill="currentColor" mask={`url(#${maskId})`} />

      {/* SnapServe brand bar as shoulders */}
      <rect x="5.4" y="19.2" width="13.2" height="3" rx="1.5" fill="currentColor" opacity="0.55" />
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
