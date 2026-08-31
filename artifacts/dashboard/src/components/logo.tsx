/* ── SnapServe brand components ────────────────────────────────────────────
   SnapServeIcon   — official staggered three-bar mark (theme-aware SVG)
   SnapServeAgentIcon — Headset agent mark (from @workspace/brand-icons)
   SnapServeLogo   — icon + wordmark  ("Snap" Bold / "Serve" Regular)
   SnapServeLoader — full-screen splash with brand mark
   ─────────────────────────────────────────────────────────────────────────*/

import { useEffect, useState } from "react";
import { isDirectSnapServeHost, loadHostBrand, type HostBrand } from "@/lib/white-label";

const FONT = "'Tex Gyre Heros', Helvetica, Arial, sans-serif";

/** Raster mark for favicons / downloads (full black tile). In-app chrome uses SnapServeIcon SVG. */
export const SNAPSERVE_MARK_SRC = "/brand/snapserve-mark.png";

/* ── BrandMark -----------------------------------------------------------
   Official lockup: black rounded tile + three identical pills
   (dark → mid → light, stepping down-right). Same mark on light and dark. */

interface BrandMarkProps {
  /** Pixel size of the icon (height & width). */
  iconSize?: number;
  /** Pixel height of the wordmark text. */
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
    <span className={`inline-flex items-center select-none text-foreground ${gapClass} ${className}`}>
      <SnapServeIcon size={iconSize} className="shrink-0" />
      <span
        className="leading-none"
        style={{ fontFamily: FONT, fontSize: wordmarkHeight, letterSpacing: "-0.02em", lineHeight: 1.15 }}
        aria-label="SnapServe"
      >
        <span style={{ fontWeight: 700 }}>Snap</span>
        <span style={{ fontWeight: 400, opacity: 0.72 }}>Serve</span>
      </span>
    </span>
  );
}

/**
 * Docs header lockup — same mark as BrandMark, but wordmark colors are hard-coded
 * for white docs chrome so a dark-theme first paint cannot wash out "SnapServe".
 */
export function DocsBrandMark({
  iconSize = 24,
  wordmarkHeight = 18,
  gapClass = "gap-2",
  className = "",
}: BrandMarkProps) {
  return (
    <span className={`inline-flex items-center select-none ${gapClass} ${className}`}>
      <SnapServeIcon size={iconSize} className="shrink-0" />
      <span
        className="leading-none"
        style={{
          fontFamily: FONT,
          fontSize: wordmarkHeight,
          letterSpacing: "-0.02em",
          lineHeight: 1.15,
        }}
        aria-label="SnapServe"
      >
        <span style={{ fontWeight: 700, color: "#0f172a" }}>Snap</span>
        <span style={{ fontWeight: 400, color: "#475569" }}>Serve</span>
      </span>
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
      style={{ width: size, height: size }}
    >
      <rect width="100" height="100" rx="22" fill="#000000" />
      {/* Original mark: identical capsules, dark → mid → light, stair to the right */}
      <rect x="14" y="22" width="52" height="13" rx="6.5" fill="#2A2A2A" />
      <rect x="26" y="43.5" width="52" height="13" rx="6.5" fill="#8A8A8A" />
      <rect x="38" y="65" width="52" height="13" rx="6.5" fill="#D4D4D6" />
    </svg>
  );
}

/**
 * SnapServeAgentIcon — the Headset agent mark.
 * Re-exported from @workspace/brand-icons so sidebar + agent pages share one source.
 */
export { AgentIcon as SnapServeAgentIcon } from "@workspace/brand-icons";

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

/* ── White-label host mark (booking / public pages) ----------------------- */

export function HostBrandMark({
  iconSize = 26,
  wordmarkHeight = 20,
}: {
  iconSize?: number;
  wordmarkHeight?: number;
}) {
  const [brand, setBrand] = useState<HostBrand | null>(null);
  useEffect(() => {
    void loadHostBrand().then(setBrand);
  }, []);

  if (isDirectSnapServeHost()) {
    return <BrandMark iconSize={iconSize} wordmarkHeight={wordmarkHeight} />;
  }
  if (brand?.logoUrl) {
    return (
      <span className="inline-flex items-center gap-2">
        <img src={brand.logoUrl} alt="" className="rounded object-contain" style={{ height: iconSize, width: iconSize }} />
        <span className="text-sm font-semibold tracking-tight">{brand.companyName}</span>
      </span>
    );
  }
  if (brand) {
    return <span className="text-sm font-semibold tracking-tight">{brand.companyName}</span>;
  }
  return <span className="inline-block h-6 w-24 rounded bg-muted animate-pulse" aria-hidden />;
}

/* ── Loader --------------------------------------------------------------- */

export function NeutralLoader() {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white">
      <div
        className="h-8 w-8 rounded-full border-2 border-black/10 border-t-black/70 animate-spin"
        aria-label="Loading"
      />
    </div>
  );
}

/** Splash used before paint: SnapServe wordmark only on SnapServe's own hosts. */
export function AppLoader() {
  if (isDirectSnapServeHost()) return <SnapServeLoader />;
  return <NeutralLoader />;
}

export function SnapServeLoader() {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white">
      <span className="mb-6 inline-flex">
        <SnapServeIcon size={56} />
      </span>
      <div className="flex flex-col items-center gap-1.5">
        <span
          className="leading-none text-[15px] text-[#111111]"
          style={{ fontFamily: "system-ui, sans-serif", letterSpacing: "-0.02em" }}
        >
          <span style={{ fontWeight: 700 }}>Snap</span>
          <span style={{ fontWeight: 400, opacity: 0.55 }}>Serve</span>
        </span>
      </div>
    </div>
  );
}
