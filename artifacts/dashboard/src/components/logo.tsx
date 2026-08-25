/* ── SnapServe brand components ────────────────────────────────────────────
   SnapServeIcon   — official three-bar mark (raster)
   SnapServeAgentIcon — Headset agent mark (from @workspace/brand-icons)
   SnapServeLogo   — icon + wordmark  ("Snap" Bold / "Serve" Regular)
   SnapServeLoader — full-screen splash with brand mark
   ─────────────────────────────────────────────────────────────────────────*/

import { useEffect, useState } from "react";
import { isDirectSnapServeHost, loadHostBrand, type HostBrand } from "@/lib/white-label";

const FONT = "'Tex Gyre Heros', Helvetica, Arial, sans-serif";

/** Canonical SnapServe three-bar mark (black tile). */
export const SNAPSERVE_MARK_SRC = "/brand/snapserve-mark.png";

/* ── BrandMark (theme-proof lockup) ---------------------------------------
   Raster mark on a black tile stays readable on light and dark chrome.
   Wordmark uses currentColor / text-foreground for the surrounding theme. */

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
  /** px size of the bounding box — mark scales with it */
  size?: number;
}

export function SnapServeIcon({ size = 24, className = "" }: IconProps) {
  return (
    <img
      src={SNAPSERVE_MARK_SRC}
      alt="SnapServe"
      width={size}
      height={size}
      className={`rounded-md object-cover ${className}`.trim()}
      style={{ width: size, height: size }}
      draggable={false}
    />
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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "#000" }}>
      <div
        className="h-8 w-8 rounded-full border-2 border-white/15 border-t-white/80 animate-spin"
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
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{ background: "#000" }}
    >
      <img
        src={SNAPSERVE_MARK_SRC}
        alt=""
        width={56}
        height={56}
        className="mb-6 rounded-xl object-cover"
        draggable={false}
      />

      <div className="flex flex-col items-center gap-1.5">
        <span
          className="leading-none text-[15px] text-white"
          style={{ fontFamily: "system-ui, sans-serif", letterSpacing: "-0.02em" }}
        >
          <span style={{ fontWeight: 700 }}>Snap</span>
          <span style={{ fontWeight: 400, opacity: 0.55 }}>Serve</span>
        </span>
      </div>
    </div>
  );
}
