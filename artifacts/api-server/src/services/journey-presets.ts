/**
 * Journey preset builders — compile product presets into executable steps.
 *
 * Steps map onto the workflow engine (make_call / condition / delay /
 * send_webhook) plus cross-channel actions (schedule_callback,
 * send_whatsapp, send_email). SMS is not a journey messaging channel.
 */

import type { WorkflowTrigger } from "@workspace/db";
import type {
  JourneyPresetId,
  JourneySettings,
  JourneyStep,
} from "@workspace/db";

export interface BuiltJourneyPreset {
  name: string;
  description: string;
  presetId: JourneyPresetId;
  trigger: WorkflowTrigger;
  settings: JourneySettings;
  steps: JourneyStep[];
}

function sid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const DEFAULT_SETTINGS: JourneySettings = {
  callbackDelayDays: 5,
  whatsappHint: "call_summary",
  followUpOnNoAnswer: true,
  followUpOnInterested: true,
  sendWhatsappAfterCall: true,
  sendEmailAfterCall: false,
  webhookUrl: null,
};

function emailSteps(settings: JourneySettings): JourneyStep[] {
  if (!settings.sendEmailAfterCall) return [];
  return [{
    id: sid("email"),
    type: "send_email",
    emailField: "email",
    emailSubject: settings.emailSubject || undefined,
    emailBody: settings.emailBody || undefined,
    label: "Send follow-up email",
  }];
}

export const JOURNEY_PRESET_META: Record<
  Exclude<JourneyPresetId, "custom">,
  { label: string; trigger: string; firstContact: string; followups: string; channels: string; memory: string }
> = {
  event_outreach: {
    label: "Event Outreach",
    trigger: "CSV, API, website form, Luma, CRM",
    firstContact: "Call new leads automatically",
    followups: "WhatsApp after call, optional email, callback after X days",
    channels: "Phone + WhatsApp + Email",
    memory: "Save event context and every lead interaction",
  },
  inbound_booking: {
    label: "Inbound Booking",
    trigger: "Inbound phone, webcall, or callback request",
    firstContact: "Qualify the caller live",
    followups: "Book meeting, WhatsApp + email confirmations",
    channels: "Phone + booking calendar + WhatsApp + Email",
    memory: "Remember caller details and booking history",
  },
  lead_qualification: {
    label: "Lead Qualification",
    trigger: "Webhook, CSV, CRM sync, ad lead",
    firstContact: "Call, qualify, and disposition",
    followups: "CRM webhook, WhatsApp/email summary, callback if interested",
    channels: "Phone + WhatsApp + Email + webhook",
    memory: "Store intent, outcome, and next-best action",
  },
  collections_reminder: {
    label: "Collections / Reminder",
    trigger: "Scheduled list or webhook",
    firstContact: "Outbound reminder call",
    followups: "Reminder WhatsApp/email, escalate with callback if unanswered",
    channels: "Phone + WhatsApp + Email",
    memory: "Track promise-to-pay and follow-up attempts",
  },
};

export function buildJourneyPreset(
  presetId: Exclude<JourneyPresetId, "custom">,
  agentId: number,
  overrides?: Partial<JourneySettings>,
): BuiltJourneyPreset {
  const settings: JourneySettings = { ...DEFAULT_SETTINGS, ...overrides };
  const callbackDays = Math.max(1, settings.callbackDelayDays ?? 5);
  const hint = settings.whatsappHint ?? "call_summary";

  switch (presetId) {
    case "event_outreach":
      return {
        name: "Event Outreach",
        description: "Call new event leads, send WhatsApp summary, callback if they asked later or didn't answer.",
        presetId,
        trigger: { type: "form_lead", fieldMap: { phone: "phone", name: "name", email: "email" } },
        settings,
        steps: [
          { id: sid("call"), type: "make_call", agentId, phoneField: "phone", label: "Call lead" },
          ...(settings.sendWhatsappAfterCall
            ? [{
                id: sid("wa"),
                type: "send_whatsapp" as const,
                agentId,
                phoneField: "phone",
                whatsappHint: hint,
                label: "Send event WhatsApp",
              }]
            : []),
          ...emailSteps(settings),
          ...(settings.webhookUrl
            ? [{ id: sid("wh"), type: "send_webhook" as const, url: settings.webhookUrl, label: "Notify CRM" }]
            : []),
          {
            id: sid("cond_no"),
            type: "condition",
            field: "call.connected",
            op: "eq",
            value: "false",
            label: "If no answer",
          },
          ...(settings.followUpOnNoAnswer
            ? [{
                id: sid("cb"),
                type: "schedule_callback" as const,
                agentId,
                phoneField: "phone",
                callbackDelayDays: callbackDays,
                notes: "Journey follow-up: no answer",
                label: `Callback in ${callbackDays} days`,
              }]
            : []),
        ],
      };

    case "inbound_booking":
      // Inbound calls are live; this journey still accepts callback-request leads
      // via hook and dials them, then sends booking WhatsApp + webhook.
      return {
        name: "Inbound Booking",
        description: "Qualify booking leads, confirm over WhatsApp, and hand off outcomes to booking/CRM systems.",
        presetId,
        trigger: { type: "form_lead", fieldMap: { phone: "phone", name: "name", email: "email" } },
        settings: { ...settings, whatsappHint: "booking_confirmed" },
        steps: [
          { id: sid("call"), type: "make_call", agentId, phoneField: "phone", label: "Call / qualify lead" },
          {
            id: sid("wa"),
            type: "send_whatsapp",
            agentId,
            phoneField: "phone",
            whatsappHint: "booking_confirmed",
            label: "Send booking WhatsApp",
          },
          ...emailSteps({ ...settings, sendEmailAfterCall: settings.sendEmailAfterCall ?? true }),
          ...(settings.webhookUrl
            ? [{ id: sid("wh"), type: "send_webhook" as const, url: settings.webhookUrl, label: "Notify booking system" }]
            : []),
          ...(settings.followUpOnNoAnswer
            ? [
                {
                  id: sid("cond_no"),
                  type: "condition" as const,
                  field: "call.connected",
                  op: "eq" as const,
                  value: "false",
                  label: "If missed",
                },
                {
                  id: sid("cb"),
                  type: "schedule_callback" as const,
                  agentId,
                  phoneField: "phone",
                  callbackDelayDays: 1,
                  notes: "Journey follow-up: missed booking call",
                  label: "Callback next day",
                },
              ]
            : []),
        ],
      };

    case "lead_qualification":
      return {
        name: "Lead Qualification",
        description: "Call inbound leads, disposition them, push CRM webhook, and callback interested prospects.",
        presetId,
        trigger: { type: "form_lead", fieldMap: { phone: "phone", name: "name", email: "email" } },
        settings,
        steps: [
          { id: sid("call"), type: "make_call", agentId, phoneField: "phone", label: "Qualify on call" },
          ...(settings.sendWhatsappAfterCall
            ? [{
                id: sid("wa"),
                type: "send_whatsapp" as const,
                agentId,
                phoneField: "phone",
                whatsappHint: hint,
                label: "Send WhatsApp summary",
              }]
            : []),
          ...emailSteps(settings),
          ...(settings.webhookUrl
            ? [{ id: sid("wh"), type: "send_webhook" as const, url: settings.webhookUrl, label: "CRM webhook" }]
            : []),
          {
            id: sid("cond_int"),
            type: "condition",
            field: "call.connected",
            op: "eq",
            value: "true",
            label: "If connected",
          },
          ...(settings.followUpOnInterested
            ? [{
                id: sid("cb"),
                type: "schedule_callback" as const,
                agentId,
                phoneField: "phone",
                callbackDelayDays: callbackDays,
                notes: "Journey follow-up: interested / nurture",
                label: `Nurture callback in ${callbackDays} days`,
              }]
            : []),
        ],
      };

    case "collections_reminder":
      return {
        name: "Collections / Reminder",
        description: "Dial reminder lists, send WhatsApp nudges, and escalate unanswered contacts with callbacks.",
        presetId,
        trigger: { type: "form_lead", fieldMap: { phone: "phone", name: "name", email: "email" } },
        settings: { ...settings, whatsappHint: "callback_scheduled", callbackDelayDays: 1 },
        steps: [
          { id: sid("call"), type: "make_call", agentId, phoneField: "phone", label: "Reminder call" },
          {
            id: sid("wa"),
            type: "send_whatsapp",
            agentId,
            phoneField: "phone",
            whatsappHint: "callback_scheduled",
            label: "Send reminder WhatsApp",
          },
          ...emailSteps(settings),
          {
            id: sid("cond_no"),
            type: "condition",
            field: "call.connected",
            op: "eq",
            value: "false",
            label: "If unanswered",
          },
          {
            id: sid("cb"),
            type: "schedule_callback",
            agentId,
            phoneField: "phone",
            callbackDelayDays: 1,
            notes: "Journey escalate: unanswered reminder",
            label: "Escalate callback next day",
          },
        ],
      };
  }
}

export function listJourneyPresets() {
  return (Object.keys(JOURNEY_PRESET_META) as Array<Exclude<JourneyPresetId, "custom">>).map((id) => ({
    id,
    ...JOURNEY_PRESET_META[id],
  }));
}
