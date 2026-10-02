import { z } from "zod";
import { isDateString } from "./time.js";

const dateString = z.string().refine(isDateString, "Expected YYYY-MM-DD");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");
const nonNegInt = z.number().int().min(0);
const probability = z.number().min(0).max(1);

export const salesConfigSchema = z.object({
  timezone: z.string().min(1),
  sprint: z.object({ start: dateString, end: dateString }).refine((s) => s.start <= s.end, "Sprint start must be on or before end"),
  goals: z.object({
    operatingNewPaid: nonNegInt,
    stretchNewPaid: nonNegInt,
    stretchMrrPaise: nonNegInt,
  }),
  cities: z.object({
    field: z.array(z.string().min(1)),
    remote: z.array(z.string().min(1)),
  }),
  sectors: z.array(z.string().min(1)).min(1),
  sources: z.array(z.string().min(1)).min(1),
  offer: z.object({
    monthlyFeePaise: nonNegInt,
    includedMinutes: nonNegInt,
    gstRateBps: z.number().int().min(0).max(10000),
  }),
  pilot: z.object({
    attemptAllowance: nonNegInt,
    durationDays: z.number().int().min(1),
    extensionMin: nonNegInt,
    extensionMax: nonNegInt,
    activeCapacity: nonNegInt,
  }).refine((p) => p.extensionMin <= p.extensionMax, "extensionMin must be <= extensionMax"),
  dailyTargets: z.object({
    visits: nonNegInt,
    deliveryDayVisits: nonNegInt,
    conversationsMin: nonNegInt,
    conversationsMax: nonNegInt,
    demosMin: nonNegInt,
    demosMax: nonNegInt,
    pilots: nonNegInt,
  }),
  sundayIsReview: z.boolean(),
  responseTargetMinutes: z.number().int().min(1),
  defaultInboundOwnerId: z.number().int().positive().nullable().default(null),
  businessHours: z.object({
    start: hhmm,
    end: hhmm,
    days: z.array(z.number().int().min(1).max(7)),
  }),
  forecast: z.object({
    assumptions: z.array(z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      value: probability,
    })),
  }),
}).strict();

export type SalesConfig = z.infer<typeof salesConfigSchema>;

export const DEFAULT_SALES_CONFIG: SalesConfig = {
  timezone: "Asia/Kolkata",
  sprint: { start: "2026-10-03", end: "2026-11-01" },
  goals: { operatingNewPaid: 20, stretchNewPaid: 50, stretchMrrPaise: 125_000_000 },
  cities: { field: ["Bengaluru"], remote: ["Chennai", "Hyderabad"] },
  sectors: ["HR consultancy", "Loan DSA", "Real estate", "Insurance broker", "Other SME"],
  sources: ["field_visit", "instagram_ad", "website_form", "referral", "other"],
  offer: { monthlyFeePaise: 2_500_000, includedMinutes: 5000, gstRateBps: 1800 },
  pilot: { attemptAllowance: 200, durationDays: 3, extensionMin: 100, extensionMax: 200, activeCapacity: 6 },
  dailyTargets: {
    visits: 16,
    deliveryDayVisits: 12,
    conversationsMin: 6,
    conversationsMax: 8,
    demosMin: 3,
    demosMax: 4,
    pilots: 2,
  },
  sundayIsReview: true,
  responseTargetMinutes: 15,
  defaultInboundOwnerId: null,
  businessHours: { start: "09:30", end: "19:00", days: [1, 2, 3, 4, 5, 6] },
  forecast: {
    assumptions: [
      { key: "visitToConversation", label: "Visit → buyer conversation (assumption)", value: 0.4 },
      { key: "conversationToDemo", label: "Buyer conversation → demo (assumption)", value: 0.5 },
      { key: "demoToPilot", label: "Demo → pilot (assumption)", value: 0.5 },
      { key: "pilotToPaid", label: "Pilot → paid (assumption)", value: 0.4 },
    ],
  },
};

export const FIELD_SOURCE = "field_visit";

export function isInboundSource(source: string | null | undefined): boolean {
  return Boolean(source) && source !== FIELD_SOURCE;
}
