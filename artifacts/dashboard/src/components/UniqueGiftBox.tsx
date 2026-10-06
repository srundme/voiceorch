import React from "react";

interface UniqueGiftBoxProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  showSparkles?: boolean;
}

export function UniqueGiftBox({
  className = "w-12 h-12",
  showSparkles = true,
  ...props
}: UniqueGiftBoxProps) {
  // Unique IDs for gradients to avoid collisions if multiple instances are rendered
  const idPrefix = React.useId().replace(/:/g, "");

  return (
    <svg
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <defs>
        {/* Soft shadow under the box */}
        <radialGradient
          id={`${idPrefix}-ground-shadow`}
          cx="50%"
          cy="50%"
          r="50%"
        >
          <stop offset="0%" stopColor="#0f172a" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
        </radialGradient>

        {/* Box Body Gradient: Warm Amber Gold */}
        <linearGradient
          id={`${idPrefix}-box-body`}
          x1="18"
          y1="30"
          x2="54"
          y2="62"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#FBBF24" />
          <stop offset="55%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>

        {/* Box Lid Gradient: Vibrant Lighter Gold */}
        <linearGradient
          id={`${idPrefix}-box-lid`}
          x1="14"
          y1="23"
          x2="58"
          y2="33"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#FEF08A" />
          <stop offset="40%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>

        {/* Ribbon Gradient: Emerald Green representing credits & money */}
        <linearGradient
          id={`${idPrefix}-ribbon-emerald`}
          x1="30"
          y1="16"
          x2="42"
          y2="62"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#6EE7B7" />
          <stop offset="45%" stopColor="#10B981" />
          <stop offset="100%" stopColor="#047857" />
        </linearGradient>

        {/* Ribbon Bow Left Loop */}
        <linearGradient
          id={`${idPrefix}-bow-left`}
          x1="22"
          y1="12"
          x2="36"
          y2="25"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#A7F3D0" />
          <stop offset="50%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>

        {/* Ribbon Bow Right Loop */}
        <linearGradient
          id={`${idPrefix}-bow-right`}
          x1="50"
          y1="12"
          x2="36"
          y2="25"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#A7F3D0" />
          <stop offset="50%" stopColor="#10B981" />
          <stop offset="100%" stopColor="#047857" />
        </linearGradient>

        {/* Sparkle 4-point star gradient */}
        <linearGradient
          id={`${idPrefix}-sparkle-emerald`}
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >
          <stop offset="0%" stopColor="#A7F3D0" />
          <stop offset="60%" stopColor="#10B981" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>

        <linearGradient
          id={`${idPrefix}-sparkle-gold`}
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >
          <stop offset="0%" stopColor="#FEF08A" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
      </defs>

      {/* ── Ground Shadow ── */}
      <ellipse
        cx="36"
        cy="65"
        rx="22"
        ry="3.5"
        fill={`url(#${idPrefix}-ground-shadow)`}
      />

      {/* ── Box Body ── */}
      <rect
        x="18"
        y="30"
        width="36"
        height="32"
        rx="5"
        fill={`url(#${idPrefix}-box-body)`}
      />
      {/* 3D Right shadow edge on box */}
      <path
        d="M48 30H49C51.7614 30 54 32.2386 54 35V57C54 59.7614 51.7614 62 49 62H48V30Z"
        fill="#B45309"
        fillOpacity="0.32"
      />
      {/* Subtle left highlight reflection */}
      <path
        d="M20 32C19.4477 32 19 32.4477 19 33V59C19 59.5523 19.4477 60 20 60C20.5523 60 21 59.5523 21 59V33C21 32.4477 20.5523 32 20 32Z"
        fill="#FEF08A"
        fillOpacity="0.45"
      />

      {/* ── Box Body Vertical Ribbon ── */}
      <rect
        x="31.5"
        y="30"
        width="9"
        height="32"
        fill={`url(#${idPrefix}-ribbon-emerald)`}
      />
      {/* Ribbon specular shine */}
      <line
        x1="33"
        y1="30"
        x2="33"
        y2="62"
        stroke="#A7F3D0"
        strokeWidth="1"
        strokeOpacity="0.5"
      />

      {/* ── Box Lid ── */}
      <rect
        x="14"
        y="23"
        width="44"
        height="10"
        rx="3"
        fill={`url(#${idPrefix}-box-lid)`}
      />
      {/* Lid 3D Bottom Lip Shadow */}
      <path
        d="M14 31H58V32C58 32.5523 57.5523 33 57 33H15C14.4477 33 14 32.5523 14 32V31Z"
        fill="#92400E"
        fillOpacity="0.35"
      />
      {/* Lid Top Specular Line */}
      <path
        d="M16 24.5H56"
        stroke="#FEF9C3"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeOpacity="0.75"
      />

      {/* ── Box Lid Ribbon ── */}
      <rect
        x="31.5"
        y="23"
        width="9"
        height="10"
        fill={`url(#${idPrefix}-ribbon-emerald)`}
      />

      {/* ── Ribbon Bow Left Loop ── */}
      <path
        d="M34 23.5C32 19 24 13 19 16.5C14.5 19.5 21 26 33.5 24.5Z"
        fill={`url(#${idPrefix}-bow-left)`}
      />
      <path
        d="M31.5 22C28 19.5 23 15.5 20.5 17.5C18.5 19 21.5 23 29.5 23.2Z"
        fill="#047857"
        fillOpacity="0.3"
      />

      {/* ── Ribbon Bow Right Loop ── */}
      <path
        d="M38 23.5C40 19 48 13 53 16.5C57.5 19.5 51 26 38.5 24.5Z"
        fill={`url(#${idPrefix}-bow-right)`}
      />
      <path
        d="M40.5 22C44 19.5 49 15.5 51.5 17.5C53.5 19 50.5 23 42.5 23.2Z"
        fill="#047857"
        fillOpacity="0.3"
      />

      {/* ── Bow Knot (Center Jewel / Tie) ── */}
      <rect
        x="31"
        y="21"
        width="10"
        height="6.5"
        rx="2.5"
        fill="#34D399"
      />
      <rect
        x="32"
        y="21.5"
        width="8"
        height="5.5"
        rx="2"
        fill={`url(#${idPrefix}-ribbon-emerald)`}
      />
      <circle cx="36" cy="24.2" r="1.5" fill="#FEF08A" />

      {/* ── Integrated Custom Sparkles & Magic Glow ── */}
      {showSparkles && (
        <g className="gift-sparkles-group">
          {/* Main Top-Right 4-point Diamond Star (Emerald) */}
          <path
            d="M58 8C58 13.5 63.5 13.5 63.5 13.5C63.5 13.5 58 13.5 58 19C58 13.5 52.5 13.5 52.5 13.5C52.5 13.5 58 13.5 58 8Z"
            fill={`url(#${idPrefix}-sparkle-emerald)`}
          />
          {/* Top-Right Secondary Twinkle Dot */}
          <circle cx="64" cy="8" r="1.5" fill="#34D399" />
          <circle cx="60.5" cy="22" r="1.2" fill="#6EE7B7" />

          {/* Left Top 4-point Star (Gold) */}
          <path
            d="M12 11C12 14.5 15.5 14.5 15.5 14.5C15.5 14.5 12 14.5 12 18C12 14.5 8.5 14.5 8.5 14.5C8.5 14.5 12 14.5 12 11Z"
            fill={`url(#${idPrefix}-sparkle-gold)`}
          />
          <circle cx="8" cy="8" r="1.2" fill="#FDE047" />

          {/* Bottom Floating Twinkle */}
          <circle cx="62" cy="46" r="1.3" fill="#34D399" />
          <circle cx="10" cy="44" r="1.2" fill="#FBBF24" />
        </g>
      )}
    </svg>
  );
}
