/**
 * Pure WhatsApp post-call payload shaping (no DB).
 */

import { toAbsoluteAppUrl } from "../../lib/app-domain.js";

export type WhatsappCallEndedPayload = {
  event: "call.ended";
  action: "send_whatsapp";
  phone: string;
  call_id: number;
  agent_id: number;
  agent_name: string;
  status: string;
  direction: string;
  duration_seconds: number | null;
  summary: string;
  disposition: string;
  recording_url: string;
  meeting_time?: string;
  meet_link?: string;
  template_hint: string;
  /** Concrete BSP template name when the connection maps the hint. */
  template_name?: string;
  timestamp: string;
};

function formatIst(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDisposition(disp: unknown): string {
  if (disp == null) return "";
  if (typeof disp === "string") return disp;
  if (typeof disp === "object") {
    try {
      const obj = disp as Record<string, unknown>;
      for (const k of ["outcome", "status", "disposition", "result", "intent"]) {
        const v = obj[k];
        if (v != null && String(v).trim()) return String(v);
      }
      return JSON.stringify(disp);
    } catch {
      return String(disp);
    }
  }
  return String(disp);
}

/** Build the stable post-call payload customers map to WhatsApp templates. */
export function buildWhatsappCallEndedPayload(opts: {
  call: {
    id: number;
    agentId: number;
    status: string | null;
    durationSeconds: number | null;
    callSummary: string | null;
    dispositionResult: unknown;
    recordingUrl: string | null;
  };
  agentName: string;
  phone: string;
  direction: string;
  callSummary?: string | null;
  dispositionResult?: unknown;
  meetingTime?: Date | string | null;
  meetLink?: string | null;
  /** Optional mapped BSP template name for template_hint. */
  templateName?: string | null;
}): WhatsappCallEndedPayload {
  const disposition = formatDisposition(opts.dispositionResult ?? opts.call.dispositionResult);
  const summary = opts.callSummary ?? opts.call.callSummary ?? "";
  const status = opts.call.status || "completed";

  let templateHint = "call_summary";
  if (opts.meetingTime) templateHint = "booking_confirmed";
  else if (/callback|call\s*back|call\s*later/i.test(disposition + summary)) {
    templateHint = "callback_scheduled";
  }

  const templateName = (opts.templateName ?? "").trim();

  return {
    event: "call.ended",
    action: "send_whatsapp",
    phone: opts.phone,
    call_id: opts.call.id,
    agent_id: opts.call.agentId,
    agent_name: opts.agentName,
    status,
    direction: opts.direction,
    duration_seconds: opts.call.durationSeconds ?? null,
    summary,
    disposition,
    recording_url: toAbsoluteAppUrl(opts.call.recordingUrl) || "",
    ...(opts.meetingTime ? { meeting_time: formatIst(opts.meetingTime) } : {}),
    ...(opts.meetLink ? { meet_link: opts.meetLink } : {}),
    template_hint: templateHint,
    ...(templateName ? { template_name: templateName } : {}),
    timestamp: new Date().toISOString(),
  };
}

/** Resolve BSP template name from a connection's templates map. */
export function resolveConnectionTemplateName(
  templates: Record<string, string | undefined> | null | undefined,
  hint: string,
): string | undefined {
  if (!templates || typeof templates !== "object") return undefined;
  const name = templates[hint];
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}
