/**
 * Shared lead-source options for call-plan create (compose + vibe).
 */

import type { ReactNode } from "react";
import { Users, FileSpreadsheet, ClipboardPaste, Globe, Megaphone } from "lucide-react";
import type { CallPlanTemplateId } from "./step-editor";

export type LeadSourceId = "list" | "sheet" | "paste" | "website" | "meta";

export type LeadSource = {
  id: LeadSourceId;
  title: string;
  blurb: string;
  icon: ReactNode;
  defaultTemplate: CallPlanTemplateId;
  peopleSource: "campaign" | "manual" | "sheet";
  runMode: "once" | "live";
  triggerType: "manual" | "form_lead" | "instagram_lead";
};

export const LEAD_SOURCES: LeadSource[] = [
  {
    id: "list",
    title: "Lead list (CSV)",
    blurb: "Upload under Leads, then attach on the plan.",
    icon: <Users className="size-4" />,
    defaultTemplate: "lead_followup",
    peopleSource: "campaign",
    runMode: "once",
    triggerType: "manual",
  },
  {
    id: "sheet",
    title: "Google Sheet",
    blurb: "Drain today’s rows or drip new ones into the queue.",
    icon: <FileSpreadsheet className="size-4" />,
    defaultTemplate: "sheet_live",
    peopleSource: "sheet",
    runMode: "live",
    triggerType: "manual",
  },
  {
    id: "paste",
    title: "Paste phone numbers",
    blurb: "One-off numbers for a quick run.",
    icon: <ClipboardPaste className="size-4" />,
    defaultTemplate: "soft_nudge",
    peopleSource: "manual",
    runMode: "once",
    triggerType: "manual",
  },
  {
    id: "website",
    title: "Website form",
    blurb: "Form submits enter this plan (Connections → Website).",
    icon: <Globe className="size-4" />,
    defaultTemplate: "form_followup",
    peopleSource: "manual",
    runMode: "once",
    triggerType: "form_lead",
  },
  {
    id: "meta",
    title: "Meta Lead Ads",
    blurb: "Meta form leads enter this plan (Connections → Meta).",
    icon: <Megaphone className="size-4" />,
    defaultTemplate: "form_followup",
    peopleSource: "manual",
    runMode: "once",
    triggerType: "instagram_lead",
  },
];

export function leadSourceById(id: LeadSourceId): LeadSource {
  return LEAD_SOURCES.find((s) => s.id === id) ?? LEAD_SOURCES[0]!;
}
