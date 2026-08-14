import { useId } from "react";
import { createIcon, type IconProps, O } from "./createIcon.js";

/* ── Dashboard primary ──────────────────────────────────────────────────── */

export const HomeIcon = createIcon("HomeIcon", ({ o }) => (
  <>
    {/* roof */}
    <path
      d="M4.5 11.2 12 4.8l7.5 6.4"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      opacity={o.full}
    />
    {/* body — soft rounded house */}
    <rect x="6.2" y="10.5" width="11.6" height="9.2" rx="2.2" fill="currentColor" opacity={o.mid} />
    {/* door brand bar */}
    <rect x="10.2" y="14.2" width="3.6" height="5.5" rx="1.2" fill="currentColor" opacity={o.full} />
  </>
));

export const CampaignsIcon = createIcon("CampaignsIcon", ({ o }) => (
  <>
    {/* megaphone body */}
    <path
      d="M5.5 9.2h4.2l7.8-3.6v13.2L9.7 15.2H5.5a1.8 1.8 0 0 1-1.8-1.8v-2.4A1.8 1.8 0 0 1 5.5 9.2Z"
      fill="currentColor"
      opacity={o.full}
    />
    {/* handle */}
    <rect x="5.8" y="15" width="3.2" height="4.4" rx="1.2" fill="currentColor" opacity={o.mid} />
    {/* sound bars */}
    <rect x="19" y="8.2" width="2.2" height="2.2" rx="1.1" fill="currentColor" opacity={o.soft} />
    <rect x="19" y="11.4" width="2.8" height="2.2" rx="1.1" fill="currentColor" opacity={o.mid} />
    <rect x="19" y="14.6" width="2.2" height="2.2" rx="1.1" fill="currentColor" opacity={o.soft} />
  </>
));

/** Headset agent mark — same geometry as the legacy SnapServeAgentIcon. */
export function AgentIcon({ size = 24, className = "", ...props }: IconProps) {
  const maskId = `ss-agent-${useId().replace(/:/g, "")}`;
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
      <rect x="1.1" y="7.9" width="3" height="6.4" rx="1.5" fill="currentColor" opacity={O.mid} />
      <rect x="19.9" y="7.9" width="3" height="6.4" rx="1.5" fill="currentColor" opacity={O.mid} />
      <rect width="24" height="24" fill="currentColor" mask={`url(#${maskId})`} />
      <rect x="5.4" y="19.2" width="13.2" height="3" rx="1.5" fill="currentColor" opacity={O.mid} />
    </svg>
  );
}
AgentIcon.displayName = "AgentIcon";

export const PhoneIcon = createIcon("PhoneIcon", ({ o }) => (
  <>
    <rect x="7.2" y="2.8" width="9.6" height="18.4" rx="3.2" fill="currentColor" opacity={o.full} />
    <rect x="9.4" y="5.2" width="5.2" height="1.8" rx="0.9" fill="currentColor" opacity={o.soft} />
    <circle cx="12" cy="18.4" r="1.35" fill="currentColor" opacity={o.mid} />
  </>
));

export const ConnectionsIcon = createIcon("ConnectionsIcon", ({ o }) => (
  <>
    <rect x="2.5" y="8.2" width="7.2" height="7.6" rx="2.2" fill="currentColor" opacity={o.full} />
    <rect x="14.3" y="8.2" width="7.2" height="7.6" rx="2.2" fill="currentColor" opacity={o.full} />
    <rect x="9" y="10.6" width="6" height="2.8" rx="1.4" fill="currentColor" opacity={o.mid} />
    <circle cx="6.1" cy="12" r="1.3" fill="currentColor" opacity={o.soft} />
    <circle cx="17.9" cy="12" r="1.3" fill="currentColor" opacity={o.soft} />
  </>
));

export const HistoryIcon = createIcon("HistoryIcon", ({ o }) => (
  <>
    <circle cx="12" cy="12.2" r="8.2" fill="currentColor" opacity={o.mid} />
    <circle cx="12" cy="12.2" r="5.6" fill="currentColor" opacity={o.soft} />
    {/* hands as brand bars */}
    <rect x="11.1" y="7.4" width="1.8" height="5.4" rx="0.9" fill="currentColor" opacity={o.full} />
    <rect x="11.1" y="11.4" width="4.6" height="1.8" rx="0.9" fill="currentColor" opacity={o.full} />
  </>
));

export const AnalyticsIcon = createIcon("AnalyticsIcon", ({ o }) => (
  <>
    <rect x="3.5" y="14.2" width="4" height="6.2" rx="1.6" fill="currentColor" opacity={o.soft} />
    <rect x="10" y="9.6" width="4" height="10.8" rx="1.6" fill="currentColor" opacity={o.mid} />
    <rect x="16.5" y="4.8" width="4" height="15.6" rx="1.6" fill="currentColor" opacity={o.full} />
  </>
));

export const KnowledgeIcon = createIcon("KnowledgeIcon", ({ o }) => (
  <>
    <path
      d="M4.2 6.2c0-1.1.9-2 2-2H11v13.6H6.2c-1.1 0-2-.9-2-2V6.2Z"
      fill="currentColor"
      opacity={o.full}
    />
    <path
      d="M12.8 4.2H17.8c1.1 0 2 .9 2 2v9.6c0 1.1-.9 2-2 2h-5V4.2Z"
      fill="currentColor"
      opacity={o.mid}
    />
    <rect x="6.4" y="7.2" width="3.2" height="1.6" rx="0.8" fill="currentColor" opacity={o.soft} />
    <rect x="14.4" y="7.2" width="3.2" height="1.6" rx="0.8" fill="currentColor" opacity={o.soft} />
  </>
));

export const MemoryIcon = createIcon("MemoryIcon", ({ o }) => (
  <>
    <rect x="3.2" y="5.5" width="17.6" height="13" rx="3.2" fill="currentColor" opacity={o.mid} />
    <circle cx="8" cy="12" r="2.1" fill="currentColor" opacity={o.full} />
    <circle cx="12" cy="12" r="2.1" fill="currentColor" opacity={o.full} />
    <circle cx="16" cy="12" r="2.1" fill="currentColor" opacity={o.full} />
    <rect x="7" y="16.2" width="10" height="1.6" rx="0.8" fill="currentColor" opacity={o.soft} />
  </>
));

export const SquadsIcon = createIcon("SquadsIcon", ({ o }) => (
  <>
    <rect x="3.2" y="3.8" width="6.4" height="6.4" rx="2.2" fill="currentColor" opacity={o.full} />
    <rect x="14.4" y="3.8" width="6.4" height="6.4" rx="2.2" fill="currentColor" opacity={o.mid} />
    <rect x="8.8" y="13.8" width="6.4" height="6.4" rx="2.2" fill="currentColor" opacity={o.full} />
    <rect x="5.6" y="9.4" width="1.8" height="5.2" rx="0.9" fill="currentColor" opacity={o.soft} />
    <rect x="16.6" y="9.4" width="1.8" height="5.2" rx="0.9" fill="currentColor" opacity={o.soft} />
    <rect x="7.2" y="13.6" width="9.6" height="1.8" rx="0.9" fill="currentColor" opacity={o.soft} />
  </>
));

export const BookingsIcon = createIcon("BookingsIcon", ({ o }) => (
  <>
    <rect x="3.5" y="5.2" width="17" height="15.2" rx="3" fill="currentColor" opacity={o.mid} />
    <rect x="3.5" y="5.2" width="17" height="4.2" rx="3" fill="currentColor" opacity={o.full} />
    <rect x="7" y="3.2" width="2" height="3.6" rx="1" fill="currentColor" opacity={o.full} />
    <rect x="15" y="3.2" width="2" height="3.6" rx="1" fill="currentColor" opacity={o.full} />
    <rect x="7" y="12.4" width="4.2" height="2.4" rx="1.1" fill="currentColor" opacity={o.full} />
    <rect x="12.8" y="12.4" width="4.2" height="2.4" rx="1.1" fill="currentColor" opacity={o.soft} />
    <rect x="7" y="16" width="4.2" height="2.4" rx="1.1" fill="currentColor" opacity={o.soft} />
  </>
));

export const SettingsIcon = createIcon("SettingsIcon", ({ o }) => (
  <>
    <circle cx="12" cy="12" r="3.2" fill="currentColor" opacity={o.full} />
    <rect x="10.6" y="2.6" width="2.8" height="4.2" rx="1.4" fill="currentColor" opacity={o.mid} />
    <rect x="10.6" y="17.2" width="2.8" height="4.2" rx="1.4" fill="currentColor" opacity={o.mid} />
    <rect x="2.6" y="10.6" width="4.2" height="2.8" rx="1.4" fill="currentColor" opacity={o.mid} />
    <rect x="17.2" y="10.6" width="4.2" height="2.8" rx="1.4" fill="currentColor" opacity={o.mid} />
    <rect x="4.4" y="4.4" width="2.8" height="4" rx="1.4" transform="rotate(-45 5.8 6.4)" fill="currentColor" opacity={o.soft} />
    <rect x="16.8" y="15.6" width="2.8" height="4" rx="1.4" transform="rotate(-45 18.2 17.6)" fill="currentColor" opacity={o.soft} />
    <rect x="16.8" y="4.4" width="2.8" height="4" rx="1.4" transform="rotate(45 18.2 6.4)" fill="currentColor" opacity={o.soft} />
    <rect x="4.4" y="15.6" width="2.8" height="4" rx="1.4" transform="rotate(45 5.8 17.6)" fill="currentColor" opacity={o.soft} />
  </>
));

export const ProvidersIcon = createIcon("ProvidersIcon", ({ o }) => (
  <>
    <rect x="9.2" y="3.2" width="5.6" height="11.6" rx="2.8" fill="currentColor" opacity={o.full} />
    <path
      d="M7 13.2a5 5 0 0 0 10 0"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      fill="none"
      opacity={o.mid}
    />
    <rect x="11" y="17.4" width="2" height="3.4" rx="1" fill="currentColor" opacity={o.mid} />
    <rect x="8.2" y="20.2" width="7.6" height="1.8" rx="0.9" fill="currentColor" opacity={o.soft} />
  </>
));

export const DevelopersIcon = createIcon("DevelopersIcon", ({ o }) => (
  <>
    <rect x="4.2" y="9.4" width="11.2" height="5.2" rx="2.6" fill="currentColor" opacity={o.full} />
    <circle cx="8.4" cy="12" r="1.5" fill="currentColor" opacity={o.soft} />
    <rect x="14.2" y="10.6" width="6.2" height="2.8" rx="1.4" fill="currentColor" opacity={o.mid} />
    <rect x="18.6" y="8.2" width="2" height="7.6" rx="1" fill="currentColor" opacity={o.soft} />
  </>
));

export const BillingIcon = createIcon("BillingIcon", ({ o }) => (
  <>
    <rect x="3.2" y="6.2" width="17.6" height="12.4" rx="3" fill="currentColor" opacity={o.mid} />
    <rect x="3.2" y="9.2" width="17.6" height="2.8" rx="0" fill="currentColor" opacity={o.full} />
    <rect x="6" y="14.4" width="5.2" height="2" rx="1" fill="currentColor" opacity={o.full} />
    <rect x="12.4" y="14.4" width="3.2" height="2" rx="1" fill="currentColor" opacity={o.soft} />
  </>
));

export const PartnerIcon = createIcon("PartnerIcon", ({ o }) => (
  <>
    {/* two soft arcs meeting — handshake silhouette */}
    <path
      d="M4.5 14.5c1.8-3.2 4.6-5 7.5-5s5.7 1.8 7.5 5"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      fill="none"
      opacity={o.mid}
    />
    <rect x="5.5" y="13.2" width="5.2" height="3.2" rx="1.6" fill="currentColor" opacity={o.full} />
    <rect x="13.3" y="13.2" width="5.2" height="3.2" rx="1.6" fill="currentColor" opacity={o.full} />
    <rect x="9.4" y="11.4" width="5.2" height="2.4" rx="1.2" fill="currentColor" opacity={o.soft} />
  </>
));

export const CreateIcon = createIcon("CreateIcon", ({ o }) => (
  <>
    <rect x="10.2" y="3.2" width="3.6" height="17.6" rx="1.8" fill="currentColor" opacity={o.full} />
    <rect x="3.2" y="10.2" width="17.6" height="3.6" rx="1.8" fill="currentColor" opacity={o.full} />
    <circle cx="12" cy="12" r="2.4" fill="currentColor" opacity={o.soft} />
  </>
));

/* ── Admin / shared extras ──────────────────────────────────────────────── */

export const OverviewIcon = createIcon("OverviewIcon", ({ o }) => (
  <>
    <rect x="3.2" y="3.2" width="7.6" height="7.6" rx="2.4" fill="currentColor" opacity={o.full} />
    <rect x="13.2" y="3.2" width="7.6" height="7.6" rx="2.4" fill="currentColor" opacity={o.mid} />
    <rect x="3.2" y="13.2" width="7.6" height="7.6" rx="2.4" fill="currentColor" opacity={o.mid} />
    <rect x="13.2" y="13.2" width="7.6" height="7.6" rx="2.4" fill="currentColor" opacity={o.soft} />
  </>
));

export const HealthIcon = createIcon("HealthIcon", ({ o }) => (
  <>
    <path
      d="M4 12.2h3.2l2-5.2 3.6 10.4 2.2-5.2H20"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      opacity={o.full}
    />
    <rect x="3.2" y="18.4" width="17.6" height="2.2" rx="1.1" fill="currentColor" opacity={o.soft} />
  </>
));

export const PulseIcon = createIcon("PulseIcon", ({ o }) => (
  <>
    <circle cx="12" cy="13.2" r="7.6" fill="currentColor" opacity={o.mid} />
    <circle cx="12" cy="13.2" r="2.2" fill="currentColor" opacity={o.full} />
    <rect x="10.8" y="3.4" width="2.4" height="4.2" rx="1.2" fill="currentColor" opacity={o.full} />
    <rect x="16.8" y="5.6" width="2.4" height="3.6" rx="1.2" transform="rotate(45 18 7.4)" fill="currentColor" opacity={o.soft} />
  </>
));

export const LineGrowthIcon = createIcon("LineGrowthIcon", ({ o }) => (
  <>
    <rect x="3.2" y="18.4" width="17.6" height="2.2" rx="1.1" fill="currentColor" opacity={o.soft} />
    <path
      d="M4.5 16.5 9 11.2l3.6 2.8L19.2 6"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      opacity={o.full}
    />
    <circle cx="19.2" cy="6" r="1.8" fill="currentColor" opacity={o.mid} />
  </>
));

export const RetentionIcon = createIcon("RetentionIcon", ({ o }) => (
  <>
    <path
      d="M12 19.6S4.8 14.8 4.8 9.6A3.8 3.8 0 0 1 12 7.4a3.8 3.8 0 0 1 7.2 2.2c0 5.2-7.2 10-7.2 10Z"
      fill="currentColor"
      opacity={o.mid}
    />
    <path
      d="M7.5 11.2h2l1.2-2.4 1.6 4.4 1.1-2H16"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      opacity={o.full}
    />
  </>
));

export const MoatIcon = createIcon("MoatIcon", ({ o }) => (
  <>
    <rect x="5.2" y="8.2" width="13.6" height="11.2" rx="3" fill="currentColor" opacity={o.mid} />
    <path
      d="M12 3.6 18.4 7.2v2.2H5.6V7.2L12 3.6Z"
      fill="currentColor"
      opacity={o.full}
    />
    <rect x="10.4" y="12.2" width="3.2" height="7.2" rx="1.2" fill="currentColor" opacity={o.full} />
    <circle cx="17.6" cy="5.2" r="1.4" fill="currentColor" opacity={o.soft} />
  </>
));

export const UnitEconomicsIcon = createIcon("UnitEconomicsIcon", ({ o }) => (
  <>
    <rect x="4.2" y="3.5" width="15.6" height="17" rx="3" fill="currentColor" opacity={o.mid} />
    <rect x="7" y="6.2" width="10" height="2.2" rx="1.1" fill="currentColor" opacity={o.full} />
    <rect x="7" y="10" width="4.2" height="2.2" rx="1.1" fill="currentColor" opacity={o.full} />
    <rect x="12.8" y="10" width="4.2" height="2.2" rx="1.1" fill="currentColor" opacity={o.soft} />
    <rect x="7" y="13.8" width="4.2" height="2.2" rx="1.1" fill="currentColor" opacity={o.soft} />
    <rect x="12.8" y="13.8" width="4.2" height="2.2" rx="1.1" fill="currentColor" opacity={o.full} />
    <rect x="7" y="17.4" width="10" height="1.8" rx="0.9" fill="currentColor" opacity={o.soft} />
  </>
));

export const CallAnalyticsIcon = createIcon("CallAnalyticsIcon", ({ o }) => (
  <>
    <path
      d="M6.2 4.5c4.8-1.2 9.2.4 11.4 4.2l-3.2 1.4c-1.2-2-3.6-3-6.2-2.4L6.2 4.5Z"
      fill="currentColor"
      opacity={o.soft}
    />
    <path
      d="M8.4 9.2c1.1-.4 2.4-.3 3.4.4l1.8-2.6c-2-1.4-4.6-1.6-6.8-.8L8.4 9.2Z"
      fill="currentColor"
      opacity={o.mid}
    />
    <path
      d="M5.2 14.8c.6 3.8 3.6 6.4 7.8 6.4 1.4 0 2.8-.3 4-.9l-1.6-2.8c-.7.3-1.5.5-2.4.5-2.4 0-4.1-1.4-4.6-3.4L5.2 14.8Z"
      fill="currentColor"
      opacity={o.full}
    />
    <circle cx="16.8" cy="16.2" r="3.4" fill="currentColor" opacity={o.mid} />
    <rect x="16" y="14.6" width="1.6" height="3.4" rx="0.8" fill="currentColor" opacity={o.full} />
  </>
));

export const UsersIcon = createIcon("UsersIcon", ({ o }) => (
  <>
    <circle cx="9" cy="8.2" r="3.2" fill="currentColor" opacity={o.full} />
    <path d="M3.5 18.8c0-3.2 2.4-5.4 5.5-5.4s5.5 2.2 5.5 5.4" fill="currentColor" opacity={o.mid} />
    <circle cx="16.6" cy="9" r="2.6" fill="currentColor" opacity={o.mid} />
    <path d="M14.2 18.8c.4-2.2 2-3.8 4.4-3.8 1 .1 1.9.4 2.6 1" fill="currentColor" opacity={o.soft} />
  </>
));

export const RechargesIcon = createIcon("RechargesIcon", ({ o }) => (
  <>
    <circle cx="12" cy="12" r="8.4" fill="currentColor" opacity={o.mid} />
    <rect x="10.6" y="6.4" width="2.8" height="11.2" rx="1.4" fill="currentColor" opacity={o.full} />
    <path
      d="M9.2 9.2c1.2-1.4 2.4-2 3.8-2 2.2 0 3.6 1.2 3.6 3s-1.2 2.6-3.2 3.2l3.4 3.4"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      opacity={o.full}
    />
  </>
));

export const AuditIcon = createIcon("AuditIcon", ({ o }) => (
  <>
    <rect x="5" y="3.5" width="14" height="17" rx="2.8" fill="currentColor" opacity={o.mid} />
    <rect x="8" y="6.4" width="8" height="2" rx="1" fill="currentColor" opacity={o.full} />
    <rect x="8" y="10.2" width="8" height="2" rx="1" fill="currentColor" opacity={o.soft} />
    <rect x="8" y="14" width="5.2" height="2" rx="1" fill="currentColor" opacity={o.full} />
    <circle cx="16.2" cy="17.4" r="3.2" fill="currentColor" opacity={o.full} />
    <path d="M15 17.4h2.4M16.2 16.2v2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity={o.soft} />
  </>
));

export const UsageIcon = createIcon("UsageIcon", ({ o }) => (
  <>
    <rect x="3.5" y="16.8" width="3.2" height="3.6" rx="1.2" fill="currentColor" opacity={o.soft} />
    <rect x="8.1" y="12.4" width="3.2" height="8" rx="1.2" fill="currentColor" opacity={o.mid} />
    <rect x="12.7" y="8.2" width="3.2" height="12.2" rx="1.2" fill="currentColor" opacity={o.full} />
    <rect x="17.3" y="5.2" width="3.2" height="15.2" rx="1.2" fill="currentColor" opacity={o.mid} />
  </>
));

export const PlatformIcon = createIcon("PlatformIcon", ({ o }) => (
  <>
    <rect x="4" y="4" width="16" height="16" rx="3.2" fill="currentColor" opacity={o.mid} />
    <rect x="7.2" y="7.2" width="4" height="4" rx="1.2" fill="currentColor" opacity={o.full} />
    <rect x="12.8" y="7.2" width="4" height="4" rx="1.2" fill="currentColor" opacity={o.full} />
    <rect x="7.2" y="12.8" width="4" height="4" rx="1.2" fill="currentColor" opacity={o.full} />
    <rect x="12.8" y="12.8" width="4" height="4" rx="1.2" fill="currentColor" opacity={o.soft} />
  </>
));

export const GrowthIcon = createIcon("GrowthIcon", ({ o }) => (
  <>
    <rect x="4" y="13.2" width="4" height="7.2" rx="1.6" fill="currentColor" opacity={o.soft} />
    <rect x="10" y="8.4" width="4" height="12" rx="1.6" fill="currentColor" opacity={o.mid} />
    <rect x="16" y="3.8" width="4" height="16.6" rx="1.6" fill="currentColor" opacity={o.full} />
  </>
));

export const SignupsIcon = createIcon("SignupsIcon", ({ o }) => (
  <>
    <circle cx="10" cy="8" r="3.4" fill="currentColor" opacity={o.full} />
    <path d="M4 19c0-3.4 2.6-5.8 6-5.8 2.2 0 4.1 1 5.1 2.5" fill="currentColor" opacity={o.mid} />
    <rect x="15.2" y="12.4" width="2.4" height="7.2" rx="1.2" fill="currentColor" opacity={o.full} />
    <rect x="12.8" y="14.8" width="7.2" height="2.4" rx="1.2" fill="currentColor" opacity={o.full} />
  </>
));

export const EmailIcon = createIcon("EmailIcon", ({ o }) => (
  <>
    <rect x="3.2" y="5.5" width="17.6" height="13" rx="3" fill="currentColor" opacity={o.mid} />
    <path
      d="M4.2 7.2 12 12.6 19.8 7.2"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      opacity={o.full}
    />
  </>
));

export const ManagedKeysIcon = createIcon("ManagedKeysIcon", ({ o }) => (
  <>
    <circle cx="9" cy="12" r="4.4" fill="currentColor" opacity={o.full} />
    <circle cx="9" cy="12" r="1.6" fill="currentColor" opacity={o.soft} />
    <rect x="12.6" y="10.6" width="8" height="2.8" rx="1.4" fill="currentColor" opacity={o.mid} />
    <rect x="17.4" y="8.4" width="2" height="2.4" rx="0.8" fill="currentColor" opacity={o.soft} />
    <rect x="17.4" y="13.2" width="2" height="2.4" rx="0.8" fill="currentColor" opacity={o.soft} />
  </>
));

export const ManagedNumbersIcon = createIcon("ManagedNumbersIcon", ({ o }) => (
  <>
    <rect x="5.5" y="3.2" width="13" height="17.6" rx="3.2" fill="currentColor" opacity={o.mid} />
    <rect x="8.2" y="6" width="7.6" height="2" rx="1" fill="currentColor" opacity={o.full} />
    <rect x="8.2" y="10" width="7.6" height="2" rx="1" fill="currentColor" opacity={o.soft} />
    <rect x="8.2" y="14" width="4.8" height="2" rx="1" fill="currentColor" opacity={o.full} />
  </>
));

export const VoicesIcon = createIcon("VoicesIcon", ({ o }) => (
  <>
    <rect x="4.5" y="9.2" width="2.4" height="5.6" rx="1.2" fill="currentColor" opacity={o.soft} />
    <rect x="8.3" y="6.4" width="2.4" height="11.2" rx="1.2" fill="currentColor" opacity={o.mid} />
    <rect x="12.1" y="4.2" width="2.4" height="15.6" rx="1.2" fill="currentColor" opacity={o.full} />
    <rect x="15.9" y="7.4" width="2.4" height="9.2" rx="1.2" fill="currentColor" opacity={o.mid} />
  </>
));

export const PromptIcon = createIcon("PromptIcon", ({ o }) => (
  <>
    <rect x="4.2" y="3.5" width="15.6" height="17" rx="3" fill="currentColor" opacity={o.mid} />
    <rect x="7" y="7" width="10" height="2.2" rx="1.1" fill="currentColor" opacity={o.full} />
    <rect x="7" y="11" width="7.2" height="2.2" rx="1.1" fill="currentColor" opacity={o.soft} />
    <rect x="7" y="15" width="8.8" height="2.2" rx="1.1" fill="currentColor" opacity={o.full} />
  </>
));

export const TemplatesIcon = createIcon("TemplatesIcon", ({ o }) => (
  <>
    <rect x="4" y="6.5" width="13.5" height="13" rx="2.6" fill="currentColor" opacity={o.soft} />
    <rect x="5.8" y="4.8" width="13.5" height="13" rx="2.6" fill="currentColor" opacity={o.mid} />
    <rect x="7.6" y="3.2" width="13.5" height="13" rx="2.6" fill="currentColor" opacity={o.full} />
  </>
));

export const AmbientIcon = createIcon("AmbientIcon", ({ o }) => (
  <>
    <rect x="4.2" y="8.2" width="4.4" height="7.6" rx="1.6" fill="currentColor" opacity={o.full} />
    <path
      d="M8.6 9.4c3.2-2.4 7.2-2.4 10.4 0"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      fill="none"
      opacity={o.mid}
    />
    <path
      d="M8.6 14.6c3.2 2.4 7.2 2.4 10.4 0"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      fill="none"
      opacity={o.soft}
    />
    <circle cx="17.8" cy="12" r="2" fill="currentColor" opacity={o.full} />
  </>
));

export const SchedulingIcon = createIcon("SchedulingIcon", ({ o }) => (
  <>
    <rect x="3.5" y="5" width="17" height="15.4" rx="3" fill="currentColor" opacity={o.mid} />
    <rect x="3.5" y="5" width="17" height="4" rx="3" fill="currentColor" opacity={o.full} />
    <rect x="7" y="3" width="2" height="3.4" rx="1" fill="currentColor" opacity={o.full} />
    <rect x="15" y="3" width="2" height="3.4" rx="1" fill="currentColor" opacity={o.full} />
    <circle cx="9" cy="13.6" r="1.5" fill="currentColor" opacity={o.full} />
    <circle cx="12" cy="13.6" r="1.5" fill="currentColor" opacity={o.soft} />
    <circle cx="15" cy="13.6" r="1.5" fill="currentColor" opacity={o.soft} />
    <circle cx="9" cy="17" r="1.5" fill="currentColor" opacity={o.soft} />
    <circle cx="12" cy="17" r="1.5" fill="currentColor" opacity={o.full} />
  </>
));

export const GCalIcon = createIcon("GCalIcon", ({ o }) => (
  <>
    <rect x="3.5" y="5" width="17" height="15.4" rx="3" fill="currentColor" opacity={o.mid} />
    <rect x="3.5" y="5" width="17" height="4" rx="3" fill="currentColor" opacity={o.full} />
    <rect x="7" y="3" width="2" height="3.4" rx="1" fill="currentColor" opacity={o.full} />
    <rect x="15" y="3" width="2" height="3.4" rx="1" fill="currentColor" opacity={o.full} />
    {/* check mark */}
    <path
      d="M8.2 14.2 10.8 16.6 16 11.2"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      opacity={o.full}
    />
  </>
));

export const CallPricingIcon = createIcon("CallPricingIcon", ({ o }) => (
  <>
    <path
      d="M8.2 4.8c-2.8 1.4-4.4 4-4.4 7.2 0 4.6 3.4 8.2 8.2 8.2 3.2 0 5.8-1.4 7.2-3.8"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      fill="none"
      opacity={o.mid}
    />
    <rect x="11" y="7.2" width="9.2" height="6.4" rx="2.2" fill="currentColor" opacity={o.full} />
    <rect x="13" y="9.2" width="5.2" height="2.2" rx="1.1" fill="currentColor" opacity={o.soft} />
  </>
));

export const DpdpIcon = createIcon("DpdpIcon", ({ o }) => (
  <>
    <path
      d="M12 3.4 19.2 6.6v5.2c0 4.6-3.2 8.4-7.2 9.6-4-1.2-7.2-5-7.2-9.6V6.6L12 3.4Z"
      fill="currentColor"
      opacity={o.mid}
    />
    <rect x="10.6" y="9.2" width="2.8" height="6.4" rx="1.4" fill="currentColor" opacity={o.full} />
    <rect x="8.4" y="13.6" width="7.2" height="2.4" rx="1.2" fill="currentColor" opacity={o.full} />
  </>
));

export const DeploymentsIcon = createIcon("DeploymentsIcon", ({ o }) => (
  <>
    <path
      d="M12 3.2 19.4 19.2H4.6L12 3.2Z"
      fill="currentColor"
      opacity={o.mid}
    />
    <rect x="10.6" y="10.4" width="2.8" height="6.4" rx="1.4" fill="currentColor" opacity={o.full} />
    <circle cx="12" cy="8.4" r="1.6" fill="currentColor" opacity={o.full} />
    <rect x="7.2" y="19.6" width="9.6" height="1.8" rx="0.9" fill="currentColor" opacity={o.soft} />
  </>
));

export const WorkshopsIcon = createIcon("WorkshopsIcon", ({ o }) => (
  <>
    <rect x="3.2" y="12.4" width="17.6" height="7.2" rx="2.4" fill="currentColor" opacity={o.mid} />
    <path d="M5.2 12.4 12 4.6l6.8 7.8H5.2Z" fill="currentColor" opacity={o.full} />
    <rect x="10.6" y="14.4" width="2.8" height="5.2" rx="1.2" fill="currentColor" opacity={o.full} />
  </>
));

export const TrophyIcon = createIcon("TrophyIcon", ({ o }) => (
  <>
    <path
      d="M7.2 4.2h9.6v5.2c0 3.2-2 5.6-4.8 5.6S7.2 12.6 7.2 9.4V4.2Z"
      fill="currentColor"
      opacity={o.full}
    />
    <path d="M7.2 6.2H4.6c0 2.4 1.2 3.8 2.6 4.2" fill="currentColor" opacity={o.mid} />
    <path d="M16.8 6.2h2.6c0 2.4-1.2 3.8-2.6 4.2" fill="currentColor" opacity={o.mid} />
    <rect x="10.6" y="14.8" width="2.8" height="3.2" rx="1" fill="currentColor" opacity={o.mid} />
    <rect x="7.6" y="18" width="8.8" height="2.4" rx="1.2" fill="currentColor" opacity={o.soft} />
  </>
));

export const GraduationIcon = createIcon("GraduationIcon", ({ o }) => (
  <>
    <path d="M3.5 10.2 12 5.6l8.5 4.6L12 14.8 3.5 10.2Z" fill="currentColor" opacity={o.full} />
    <path d="M7.2 12.2v4.2c0 1.6 2.2 3 4.8 3s4.8-1.4 4.8-3v-4.2" fill="currentColor" opacity={o.mid} />
    <rect x="18.2" y="10.2" width="2" height="6.4" rx="1" fill="currentColor" opacity={o.soft} />
  </>
));

export const BuildingIcon = createIcon("BuildingIcon", ({ o }) => (
  <>
    <rect x="4.2" y="5.2" width="10.4" height="15.2" rx="2.2" fill="currentColor" opacity={o.mid} />
    <rect x="14.6" y="9.2" width="5.2" height="11.2" rx="2" fill="currentColor" opacity={o.soft} />
    <rect x="6.4" y="8" width="2.4" height="2.4" rx="0.8" fill="currentColor" opacity={o.full} />
    <rect x="10" y="8" width="2.4" height="2.4" rx="0.8" fill="currentColor" opacity={o.full} />
    <rect x="6.4" y="12" width="2.4" height="2.4" rx="0.8" fill="currentColor" opacity={o.full} />
    <rect x="10" y="12" width="2.4" height="2.4" rx="0.8" fill="currentColor" opacity={o.full} />
    <rect x="8.2" y="16.4" width="3.2" height="4" rx="1" fill="currentColor" opacity={o.full} />
  </>
));

export const ShieldAgentIcon = createIcon("ShieldAgentIcon", ({ o }) => (
  <>
    <path
      d="M12 3.4 19.2 6.6v5.2c0 4.6-3.2 8.4-7.2 9.6-4-1.2-7.2-5-7.2-9.6V6.6L12 3.4Z"
      fill="currentColor"
      opacity={o.mid}
    />
    <circle cx="12" cy="10.4" r="2.4" fill="currentColor" opacity={o.full} />
    <path d="M8.6 16.2c0-1.8 1.5-3 3.4-3s3.4 1.2 3.4 3" fill="currentColor" opacity={o.full} />
  </>
));

export const LogOutIcon = createIcon("LogOutIcon", ({ o }) => (
  <>
    <rect x="3.5" y="4.2" width="10.2" height="15.6" rx="2.8" fill="currentColor" opacity={o.mid} />
    <rect x="11.4" y="10.6" width="8" height="2.8" rx="1.4" fill="currentColor" opacity={o.full} />
    <path
      d="M16.2 7.8 20.2 12l-4 4.2"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      opacity={o.full}
    />
  </>
));

/** Alias used where Billing / Finance share the wallet metaphor. */
export const WalletIcon = BillingIcon;
export const FinanceIcon = BillingIcon;
/** Alias for Workspace gear. */
export const WorkspaceIcon = SettingsIcon;
/** Alias for Partners page. */
export const HandshakeIcon = PartnerIcon;
