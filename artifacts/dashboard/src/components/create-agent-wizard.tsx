import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@clerk/react";
import { useCreateAgent, getListAgentsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import {
  ASR_PROVIDERS,
  LLM_PROVIDERS,
  TTS_PROVIDERS,
  TELEPHONY_PROVIDERS,
} from "@/lib/agent-providers";
import {
  Users, Target, Headphones, Bell,
  Megaphone, Building2, Wand2, Globe,
  ChevronLeft, ChevronRight, Check, X, Loader2, Sparkles,
  Play, Pause, Volume2, Upload, FileText, PhoneForwarded,
  Languages, SkipForward, Phone, Pencil, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { VoiceInputButton } from "@/components/voice-input-button";

/* ── Use-case catalogue ─────────────────────────────────────────────────── */
const USE_CASES = [
  { id: "appointment_booking", label: "Appointment Booking Agent",  desc: "Book and confirm patient appointments automatically",                       role: "appointment booking specialist",       service: "patient appointment booking and confirmation",                 icon: Users },
  { id: "admission_assist",   label: "Admission Assist Agent",    desc: "Qualify student leads and walk them through the admission journey",         role: "admissions specialist",               service: "student lead qualification and admission journey guidance",    icon: FileText },
  { id: "policy_renewal",     label: "Policy Renewal Agent",       desc: "Remind and nudge customers before policy expiry",                           role: "policy renewal specialist",           service: "insurance policy renewal reminders and follow-ups",            icon: Megaphone },
  { id: "property_qualifier", label: "Property Lead Qualifier",    desc: "Filter serious property buyers from cold leads",                            role: "real estate sales specialist",        service: "property lead qualification and buyer intent assessment",      icon: Building2 },
  { id: "customer_support",   label: "Customer Support",           desc: "24/7 inbound call answering for FAQs and customer queries",                 role: "customer support agent",              service: "customer support and issue resolution",                        icon: Headphones },
  { id: "candidate_screen",   label: "Candidate Screening Agent",  desc: "Call applicants, ask pre-screening questions, and shortlist",               role: "talent acquisition specialist",       service: "applicant pre-screening and candidate shortlisting",           icon: Target },
  { id: "lead_qual",          label: "Lead Qualification",         desc: "Qualify and warm-introduce leads across industries",                        role: "sales representative",                service: "lead qualification and sales outreach",                        icon: Wand2 },
  { id: "reminder",           label: "Reminder Agent",             desc: "Automate EMI, policy, and interview reminders",                             role: "reminder and follow-up specialist",   service: "automated reminders for EMI payments, policy renewals, and scheduled events", icon: Bell },
];

/* ── Domain-specific micro-wizard questions ─────────────────────────────── */
type MicroQ = { q: string; hint: string; placeholder: string; type: "textarea" | "jd-upload" };

const MICRO_QUESTIONS: Record<string, MicroQ[]> = {
  appointment_booking: [
    { q: "What types of appointments or services can be booked?", hint: "e.g. consultation, follow-up, demo, therapy session", placeholder: "e.g. 30-min physiotherapy sessions, dental checkups, GP consultations...", type: "textarea" },
    { q: "What are the working hours and available days for bookings?", hint: "Include timezone if relevant", placeholder: "e.g. Monday–Friday 9am–6pm IST, Saturday 10am–2pm. Closed Sundays.", type: "textarea" },
    { q: "How far in advance can appointments be scheduled, and what is the cancellation window?", hint: "Helps the agent qualify slot requests correctly", placeholder: "e.g. Up to 30 days in advance. Cancellations must be made at least 24 hours before.", type: "textarea" },
    { q: "What information must be collected from the customer before confirming the booking?", hint: "e.g. name, phone, reason, insurance ID", placeholder: "e.g. Full name, mobile number, reason for visit, preferred date and time slot...", type: "textarea" },
    { q: "Should the agent handle rescheduling and cancellations autonomously, or escalate to a human?", hint: "Optional — leave blank to allow autonomous handling", placeholder: "e.g. Handle rescheduling autonomously. Escalate cancellations less than 24h before to a human.", type: "textarea" },
  ],
  admission_assist: [
    { q: "What course, program, or institution is the agent assisting with admissions for?", hint: "e.g. BBA, MBA, B.Tech, MBBS at XYZ University", placeholder: "e.g. B.Tech Computer Science at ABC Engineering College — 2025–26 batch admissions...", type: "textarea" },
    { q: "What are the eligibility criteria or minimum qualifications required?", hint: "e.g. 60% in 12th, JEE score, work experience", placeholder: "e.g. Minimum 60% marks in 10+2 with PCM, valid JEE Main score above 80 percentile...", type: "textarea" },
    { q: "What details or documents should the agent collect from the prospective student?", hint: "e.g. name, 12th marks, city, preferred course", placeholder: "e.g. Student name, 10+2 percentage, stream, preferred specialisation, city and phone number...", type: "textarea" },
    { q: "What are the key admission dates? e.g. application deadline, entrance exam, results", hint: "Include any batch or round cut-offs", placeholder: "e.g. Application deadline: 30 June. Entrance test: 15 July. Results: 30 July. Seat booking: 10 Aug.", type: "textarea" },
    { q: "Should the agent schedule a counselling session directly, or transfer to an admissions officer?", hint: "Optional — leave blank for autonomous scheduling", placeholder: "e.g. Schedule a 20-min counselling call directly. If student asks about scholarships, transfer to admissions officer.", type: "textarea" },
  ],
  policy_renewal: [
    { q: "What type of policies are being renewed?", hint: "e.g. health, motor, life, travel, commercial", placeholder: "e.g. Two-wheeler motor insurance policies for individual customers...", type: "textarea" },
    { q: "What is the renewal window — how many days before expiry should outreach begin?", hint: "Include any follow-up call intervals", placeholder: "e.g. First call 30 days before expiry. Follow-up at 15 days and 7 days if no response.", type: "textarea" },
    { q: "What renewal offers, discounts, or plan upgrade options should the agent communicate?", hint: "e.g. 5% early-bird discount, no-claim bonus", placeholder: "e.g. 5% early-bird discount if renewed 15+ days early. No-claim bonus of 20% for zero-claim year.", type: "textarea" },
    { q: "Should the agent collect payment intent on the call, or only confirm renewal willingness?", hint: "e.g. send a payment link, note intent, take card details", placeholder: "e.g. Confirm willingness and send a payment link via SMS. Do not collect card details on the call.", type: "textarea" },
    { q: "What action should be taken if the customer does not respond after multiple attempts?", hint: "Optional — leave blank to flag for human review", placeholder: "e.g. After 3 unanswered calls over 7 days, send a final SMS and mark the lead as lapsed.", type: "textarea" },
  ],
  property_qualifier: [
    { q: "What type of property is being sold or rented?", hint: "e.g. residential flat, commercial office, villa, plot", placeholder: "e.g. 2BHK and 3BHK residential apartments in Whitefield, Bengaluru, ready to move in...", type: "textarea" },
    { q: "What is the price range or budget bracket the agent should qualify leads against?", hint: "Include unit, currency, and any negotiation range", placeholder: "e.g. ₹60L to ₹1.2Cr. Leads below ₹50L should be redirected to the affordable housing project.", type: "textarea" },
    { q: "What signals indicate a serious buyer?", hint: "e.g. ready for site visit, loan pre-approved, immediate timeline", placeholder: "e.g. Ready for a site visit this week, has loan pre-approval or own funds, planning to buy within 3 months.", type: "textarea" },
    { q: "Should the agent schedule site visits directly, or hand off to a sales executive?", hint: "Optional — leave blank to schedule directly", placeholder: "e.g. Schedule the site visit directly for weekends. Weekday visits should be passed to the sales team.", type: "textarea" },
    { q: "How should cold or unqualified leads be handled?", hint: "Optional — leave blank to tag for nurture", placeholder: "e.g. Tag as 'warm' and add to a 30-day follow-up sequence. If budget is out of range, mark as disqualified.", type: "textarea" },
  ],
  customer_support: [
    { q: "What are the most common queries or issues customers call in about?", hint: "List the top 3–5 issues", placeholder: "e.g. Order delivery status, refund requests, EMI payment issues, product exchange, account login problems...", type: "textarea" },
    { q: "Does the agent need real-time access to account, order, or ticket data to resolve queries?", hint: "e.g. order status API, CRM, ticketing system", placeholder: "e.g. Yes — agent needs live order status via the Orders API and should be able to raise a ticket in Freshdesk.", type: "textarea" },
    { q: "What is the escalation trigger — at what point should the call go to a human agent?", hint: "e.g. after 2 failed resolution attempts, if customer is upset", placeholder: "e.g. Escalate if the issue is unresolved after 2 attempts, or if the customer explicitly requests a person.", type: "textarea" },
    { q: "What is the resolution flow for the top 3 complaint types?", hint: "Describe step-by-step for each type", placeholder: "e.g. Refunds: verify order → confirm eligibility → initiate refund → give timeline. Delivery: check status → explain or rebook...", type: "textarea" },
    { q: "Should the agent proactively collect a feedback or CSAT rating at the end of every call?", hint: "Optional — leave blank to skip CSAT collection", placeholder: "e.g. Yes — ask for a rating from 1–5 after every resolved call. If rated 1 or 2, flag for quality review.", type: "textarea" },
  ],
  candidate_screen: [
    { q: "Upload the job description or describe the role manually", hint: "Upload a PDF or DOCX, or type the role title and must-have skills below", placeholder: "e.g. Sales Executive — Must have 2+ years B2B experience, strong communication, CRM knowledge...", type: "jd-upload" },
    { q: "What are the 3 to 5 screening questions the agent must ask every candidate?", hint: "One question per line works best", placeholder: "e.g. How many years of B2B sales experience do you have?\nAre you comfortable with field visits?\nWhat CRM tools have you used?", type: "textarea" },
    { q: "What is the scoring or decision logic — what qualifies a candidate to move forward?", hint: "e.g. minimum score, knockout criteria", placeholder: "e.g. Must have 2+ years experience. Score 3 out of 5 on screening questions. Disqualify if not open to field work.", type: "textarea" },
    { q: "Should the agent inform candidates of the result on the call, or send it later via message?", hint: "e.g. instant result, 24-hour delay, recruiter reviews first", placeholder: "e.g. Inform shortlisted candidates immediately on the call. Rejected candidates receive an SMS within 24 hours.", type: "textarea" },
    { q: "What is the next step for a shortlisted candidate?", hint: "Optional — e.g. interview scheduling, assessment link, human callback", placeholder: "e.g. Schedule a video interview with the hiring manager directly. Send the assessment link via WhatsApp immediately.", type: "textarea" },
  ],
  lead_qual: [
    { q: "What product or service is being sold, and who is the target customer?", hint: "Include the core value proposition", placeholder: "e.g. SaaS-based payroll software for SMEs with 10–500 employees. Target: HR managers and business owners.", type: "textarea" },
    { q: "What 3 questions best identify a qualified lead for this business?", hint: "One question per line", placeholder: "e.g. How many employees does your company have?\nAre you currently using a payroll tool?\nWhat is your monthly payroll volume?", type: "textarea" },
    { q: "What is the minimum intent or budget signal required to pass a lead to sales?", hint: "e.g. monthly budget, intent score, decision-maker contact", placeholder: "e.g. Budget of at least ₹10K/month, actively evaluating a payroll solution, and has decision-making authority.", type: "textarea" },
    { q: "Should the agent do a warm transfer to a sales rep, or just log and notify?", hint: "Optional — leave blank for log-and-notify", placeholder: "e.g. For hot leads (score 4+), do a warm transfer to the nearest available rep. Otherwise log and send a Slack notification.", type: "textarea" },
    { q: "What should happen to unqualified leads?", hint: "Optional — leave blank to tag for nurture", placeholder: "e.g. Tag as 'nurture' and enrol in a 4-week email drip. If budget is zero, mark as disqualified and do not re-contact.", type: "textarea" },
  ],
  reminder: [
    { q: "What event or action is the reminder tied to?", hint: "e.g. EMI due date, policy expiry, interview slot, appointment", placeholder: "e.g. Monthly EMI payment due on the 5th of every month for personal loan customers...", type: "textarea" },
    { q: "How many reminder attempts should be made, and at what intervals?", hint: "Include timing relative to the event date", placeholder: "e.g. 3 attempts: 5 days before due date, 1 day before, and on the due date itself if still unpaid.", type: "textarea" },
    { q: "Should the agent accept a live confirmation, reschedule request, or payment acknowledgment on the call?", hint: "e.g. confirm receipt, take payment date, log acknowledgment", placeholder: "e.g. Collect the expected payment date. If customer says already paid, ask for transaction reference number.", type: "textarea" },
    { q: "What happens if the customer requests more time or raises a dispute on the call?", hint: "e.g. grant a grace period, escalate, log and follow up", placeholder: "e.g. Grant up to 7 days extension autonomously. For disputes, escalate immediately to the collections team.", type: "textarea" },
    { q: "Should missed or unresponsive contacts be escalated to a human, or flagged in the system?", hint: "Optional — leave blank to flag in system", placeholder: "e.g. After 3 unanswered calls, flag in CRM and send to a human collections agent for manual follow-up.", type: "textarea" },
  ],
};

/* ── Call flow builder ───────────────────────────────────────────────────── */
interface FlowNode { label: string; badge?: string; branch?: boolean; }

function buildCallFlowNodes(useCase: string, answers: string[], agentName: string, companyName: string): FlowNode[] {
  const ag = agentName.trim() || "the agent";
  const co = companyName.trim() || "your company";
  const a = answers;

  switch (useCase) {
    case "appointment_booking": return [
      { label: `${ag} greets the customer and introduces itself as ${ag} from ${co}`, badge: "Greeting" },
      { label: "Checks if this is a good time to talk", branch: true },
      { label: "If busy → asks for a preferred callback time and closes politely", branch: true },
      { label: `Explains the purpose: booking a ${a[0] || "service"}`, badge: "Purpose" },
      { label: `Checks availability within working hours: ${a[1] || "business hours"}` },
      { label: `Collects required details: ${a[3] || "name, phone, and preferred time"}`, badge: "Data Collect" },
      { label: `Confirms slot per scheduling rules: ${a[2] || "standard advance booking window"}` },
      { label: a[4] || "Handles rescheduling or escalates to a human if needed" },
      { label: "Confirms the appointment and closes the call warmly", badge: "Close" },
    ];
    case "admission_assist": return [
      { label: `${ag} greets the student and introduces itself as ${ag} from ${co}`, badge: "Greeting" },
      { label: "Checks if the student is interested in an admission enquiry", branch: true },
      { label: "If not interested → closes politely and offers a callback", branch: true },
      { label: `Introduces the program: ${a[0] || "the course"} and explains key highlights`, badge: "Program" },
      { label: `Checks eligibility: ${a[1] || "minimum qualification criteria"}` },
      { label: `Collects student details: ${a[2] || "name, marks, city, and contact"}`, badge: "Data Collect" },
      { label: `Shares key dates: ${a[3] || "application deadline and entrance exam schedule"}` },
      { label: a[4] || "Schedules a counselling session or transfers to an admissions officer", badge: "Next Step" },
      { label: "Wraps up with confirmation of next steps", badge: "Close" },
    ];
    case "policy_renewal": return [
      { label: `${ag} introduces itself as ${ag} from ${co} calling about policy renewal`, badge: "Greeting" },
      { label: "Confirms the customer's identity and checks availability", branch: true },
      { label: "If busy → schedules a callback at the customer's preferred time", branch: true },
      { label: `Explains the reason: ${a[0] || "policy"} renewal is due soon`, badge: "Purpose" },
      { label: `Outreach timing: ${a[1] || "within the defined renewal window"}` },
      { label: `Presents renewal offers: ${a[2] || "discounts and plan options"}`, badge: "Offer" },
      { label: a[3] || "Confirms renewal willingness and sends a payment link" },
      { label: a[4] || "Flags non-responsive contacts for human follow-up", badge: "Non-response" },
      { label: "Closes the call with confirmation of next steps", badge: "Close" },
    ];
    case "property_qualifier": return [
      { label: `${ag} introduces itself as ${ag} from ${co} and mentions the property`, badge: "Greeting" },
      { label: "Checks if the lead is looking for a property and has time to talk", branch: true },
      { label: "If not interested → closes politely and offers a brochure via SMS", branch: true },
      { label: `Introduces the project: ${a[0] || "the property"}`, badge: "Property" },
      { label: `Qualifies budget: confirms the range — ${a[1] || "the property price bracket"}` },
      { label: `Identifies buyer intent: ${a[2] || "site visit readiness, loan status, timeline"}`, badge: "Qualify" },
      { label: a[3] || "Schedules a site visit or passes the lead to a sales executive" },
      { label: a[4] || "Tags cold leads for nurture or marks as disqualified", badge: "Disposition" },
      { label: "Closes the call and confirms the next step", badge: "Close" },
    ];
    case "customer_support": return [
      { label: `${ag} answers the call as ${ag} from ${co} support`, badge: "Greeting" },
      { label: "Asks the customer to describe their issue", branch: true },
      { label: `Most common issues handled: ${a[0] || "FAQs and common customer queries"}`, badge: "Issue" },
      { label: a[1] ? `Accesses live data: ${a[1]}` : "Looks up order or account details if needed" },
      { label: `Resolution flow: ${a[3] || "step-by-step resolution for each query type"}`, badge: "Resolution" },
      { label: `Escalation trigger: ${a[2] || "escalates to human if unresolved after 2 attempts"}` },
      { label: a[4] || "Collects CSAT rating at end of call if issue is resolved", badge: "CSAT" },
      { label: "Closes the call with a resolution summary or ticket confirmation", badge: "Close" },
    ];
    case "candidate_screen": return [
      { label: `${ag} calls the candidate and introduces itself as ${ag} from ${co} talent team`, badge: "Greeting" },
      { label: "Checks if it's a good time to speak and confirms interest", branch: true },
      { label: "If busy or uninterested → reschedules or closes politely", branch: true },
      { label: `Confirms the role: ${(a[0] || "").slice(0, 80) || "the position applied for"}`, badge: "Role" },
      { label: `Asks screening questions: ${a[1] || "3–5 defined screening questions"}`, badge: "Screen" },
      { label: `Evaluates against criteria: ${a[2] || "defined scoring and qualification logic"}` },
      { label: a[3] || "Informs the candidate of the result on the call or sends it later" },
      { label: `Next step for shortlisted: ${a[4] || "interview scheduling, assessment link, or callback"}`, badge: "Next Step" },
      { label: "Closes the call warmly with timeline clarity", badge: "Close" },
    ];
    case "lead_qual": return [
      { label: `${ag} introduces itself as ${ag} from ${co} and states the purpose`, badge: "Greeting" },
      { label: "Checks if the prospect has a moment to talk", branch: true },
      { label: "If busy → schedules a callback or closes politely", branch: true },
      { label: `Introduces the offering: ${a[0] || "the product or service"}`, badge: "Pitch" },
      { label: `Asks qualifying questions: ${a[1] || "3 key qualifying questions"}`, badge: "Qualify" },
      { label: `Checks intent threshold: ${a[2] || "minimum budget or intent signal"}` },
      { label: a[3] || "Warm transfers to sales rep or logs and notifies" },
      { label: a[4] || "Tags unqualified leads for nurture or disqualifies", badge: "Disposition" },
      { label: "Closes the call and confirms next steps", badge: "Close" },
    ];
    case "reminder": return [
      { label: `${ag} calls the customer as ${ag} from ${co} with a reminder`, badge: "Greeting" },
      { label: "Confirms the customer's identity before sharing details", branch: true },
      { label: "If wrong number or unavailable → logs and re-attempts as scheduled", branch: true },
      { label: `Delivers the reminder: ${a[0] || "upcoming due event or deadline"}`, badge: "Reminder" },
      { label: `Call schedule: ${a[1] || "defined attempts at set intervals"}` },
      { label: `Collects response: ${a[2] || "confirmation, reschedule, or acknowledgment"}`, badge: "Response" },
      { label: a[3] || "Handles disputes or extension requests per defined rules" },
      { label: a[4] || "Escalates missed contacts to human or flags in system", badge: "Non-response" },
      { label: "Closes the call with a summary of what was agreed", badge: "Close" },
    ];
    default: return [
      { label: `${ag} greets the customer and introduces itself as ${ag} from ${co}`, badge: "Greeting" },
      { label: "Opens the conversation based on the use case purpose", branch: true },
      { label: "Handles the main interaction flow", badge: "Main Flow" },
      { label: "Collects any required information or confirmation", badge: "Data Collect" },
      { label: "Resolves the call objective or escalates as needed" },
      { label: "Closes the call warmly with confirmed next steps", badge: "Close" },
    ];
  }
}

function nodesToText(nodes: FlowNode[]): string {
  return nodes.map((n, i) => {
    const prefix = n.branch ? "  →" : `${i + 1}.`;
    return `${prefix} ${n.label}${n.badge ? ` [${n.badge}]` : ""}`;
  }).join("\n");
}

function textToNodes(text: string): FlowNode[] {
  return text.split("\n")
    .filter(l => l.trim().length > 0)
    .map(line => {
      const isBranch = line.trimStart().startsWith("→") || line.startsWith("  ");
      const stripped = line.trim().replace(/^(\d+\.\s*|→\s*)/, "");
      const badgeMatch = stripped.match(/\s*\[([^\]]+)\]\s*$/);
      const label = badgeMatch ? stripped.slice(0, stripped.lastIndexOf("[")).trim() : stripped.trim();
      return { label: label || stripped, badge: badgeMatch?.[1], branch: isBranch };
    })
    .filter(n => n.label.length > 0);
}

/* ── MicroAnswers ─────────────────────────────────────────────────────────── */
interface MicroAnswers {
  answers: string[];
  jdFileContent: string;
  jdFileName: string;
}
const MICRO_INIT: MicroAnswers = { answers: [], jdFileContent: "", jdFileName: "" };

/* ── Language catalogue ─────────────────────────────────────────────────── */
const LANGUAGES = [
  { code: "english",   label: "English" },
  { code: "hindi",     label: "Hindi" },
  { code: "tamil",     label: "Tamil" },
  { code: "telugu",    label: "Telugu" },
  { code: "kannada",   label: "Kannada" },
  { code: "marathi",   label: "Marathi" },
  { code: "gujarati",  label: "Gujarati" },
  { code: "bengali",   label: "Bengali" },
  { code: "malayalam", label: "Malayalam" },
];

/* ── Managed stack ──────────────────────────────────────────────────────── */
const LANG_CODE_MAP: Record<string, string> = {
  english: "en-US", hindi: "hi", tamil: "ta", telugu: "te",
  kannada: "kn", marathi: "mr", gujarati: "gu", bengali: "bn", malayalam: "ml",
};
const ASR_LANG_CODE_MAP: Record<string, string> = {
  english: "en", hindi: "hi", tamil: "ta-IN", telugu: "te-IN",
  kannada: "kn-IN", marathi: "mr-IN", gujarati: "gu-IN", bengali: "bn-IN", malayalam: "ml-IN",
};

function getManagedStack(languages: string[]) {
  const hasTamil = languages.includes("tamil");
  const hasIndic = languages.some(l => ["hindi","telugu","kannada","marathi","gujarati","bengali","malayalam"].includes(l));
  return {
    asrProvider:       (hasTamil || hasIndic) ? "sarvam" : "deepgram",
    asrModel:          (hasTamil || hasIndic) ? "saarika:v2.5" : "nova-2-general",
    llmProvider:       (hasTamil || hasIndic) ? "google" : "sarvam",
    llmModel:          (hasTamil || hasIndic) ? "gemini-2.5-flash" : "sarvam-m",
    ttsProvider:       "cartesia",
    ttsModel:          "sonic-3.5",
    telephonyProvider: "vobiz",
  };
}

/* ── Default Arushi voice ───────────────────────────────────────────────── */
const ARUSHI_VOICE = {
  id: "2ee87190-8f84-4925-97da-e52547f9462c",
  name: "Arushi",
  language: "en",
  description: "Warm Indian English female — Cartesia",
};

const FALLBACK_VOICES = [ARUSHI_VOICE];

const LANG_LABEL: Record<string, string> = {
  hi: "Hindi", ta: "Tamil", te: "Telugu", kn: "Kannada",
  ml: "Malayalam", bn: "Bengali", mr: "Marathi", gu: "Gujarati",
  pa: "Punjabi", "en-IN": "English · IN", en: "English",
};

/* ── Types ──────────────────────────────────────────────────────────────── */
interface CartesiaVoice { id: string; name: string; description: string; language?: string }
type AgentDirection = "inbound" | "outbound" | "both";

interface LeadSourceState {
  enabled: boolean;
  type: "instagram";
  token: string;
  fields: string[];       // checked fields — sent to backend
  customFields: string[]; // user-added slugs that exist (may or may not be checked)
}

interface WizardState {
  mode: "byop" | "managed" | null;
  useCase: string; useCaseRole: string; useCaseService: string;
  isMultilingual: boolean; primaryLanguage: string; additionalLanguages: string[];
  agentName: string; companyName: string; agentDirection: AgentDirection;
  callFlowDescription: string; generatedPrompt: string;
  kbContent: string; kbFileName: string;
  voices: CartesiaVoice[]; selectedVoiceId: string;
  callTransferEnabled: boolean; callTransferNumber: string;
  byopAsr: string; byopLlm: string; byopTts: string; byopTelephony: string; byopPrompt: string;
  leadSource: LeadSourceState;
  productDetails: string;
  microAnswers?: Array<{ question: string; answer: string }>;
  jdFileContent?: string;
  jdFileName?: string;
}

const DEFAULT_LEAD_FIELDS = ["name", "email", "message"] as const;

const INITIAL: WizardState = {
  mode: null, useCase: "", useCaseRole: "", useCaseService: "",
  isMultilingual: false, primaryLanguage: "english", additionalLanguages: [],
  agentName: "", companyName: "", agentDirection: "inbound",
  callFlowDescription: "", generatedPrompt: "",
  kbContent: "", kbFileName: "",
  voices: FALLBACK_VOICES, selectedVoiceId: ARUSHI_VOICE.id,
  callTransferEnabled: false, callTransferNumber: "",
  byopAsr: "deepgram", byopLlm: "openai", byopTts: "elevenlabs", byopTelephony: "twilio",
  byopPrompt: "You are a helpful AI voice assistant. Be concise and professional.",
  leadSource: { enabled: false, type: "instagram", token: "", fields: [...DEFAULT_LEAD_FIELDS], customFields: [] },
  productDetails: "",
};

/* ── Voice preview ──────────────────────────────────────────────────────── */
const PREVIEW_TEXT = "Hello! I am your AI voice assistant. I am here to help you today. How can I assist you?";

function speakWithBrowser(voiceName: string, onEnd: () => void) {
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(PREVIEW_TEXT);
  const voices = window.speechSynthesis.getVoices();
  const femaleKeywords = ["female", "woman", "girl", "zira", "samantha", "victoria", "moira", "fiona", "veena"];
  const maleKeywords   = ["male", "man", "daniel", "alex", "tom", "fred", "lee"];
  const isFemale = false;
  const match = voices.find(v => {
    const n = v.name.toLowerCase();
    return isFemale ? femaleKeywords.some(k => n.includes(k)) : maleKeywords.some(k => n.includes(k));
  }) ?? voices[0];
  if (match) utter.voice = match;
  utter.rate  = 0.95;
  utter.pitch = isFemale ? 1.1 : 0.9;
  utter.onend = onEnd;
  utter.onerror = onEnd;
  window.speechSynthesis.speak(utter);
}

function useVoicePreview(apiFetch: (path: string, init?: RequestInit) => Promise<Response>) {
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voicesRef = useRef<CartesiaVoice[]>([]);

  function setVoicesRef(voices: CartesiaVoice[]) { voicesRef.current = voices; }

  async function preview(voiceId: string) {
    if (playing === voiceId) {
      audioRef.current?.pause();
      window.speechSynthesis.cancel();
      setPlaying(null);
      return;
    }
    setPlaying(voiceId);

    try {
      const res = await apiFetch("/api/wizard/preview-voice", {
        method: "POST",
        body: JSON.stringify({ voiceId, text: PREVIEW_TEXT, modelId: "sonic-3.5" }),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (audioRef.current) { audioRef.current.pause(); URL.revokeObjectURL(audioRef.current.src); }
        const el = new Audio(url);
        audioRef.current = el;
        el.onended = () => { setPlaying(null); URL.revokeObjectURL(url); };
        el.onerror = () => { setPlaying(null); URL.revokeObjectURL(url); };
        void el.play();
        return;
      }

      if (res.status === 503) {
        setPlaying(null);
        const voice = voicesRef.current.find(v => v.id === voiceId);
        speakWithBrowser(voice?.name ?? "", () => setPlaying(null));
        return;
      }

      setPlaying(null);
    } catch {
      setPlaying(null);
    }
  }

  return { playing, preview, setVoicesRef };
}

/* ── Pure payload builder (exported for testing) ─────────────────────────── */
export function buildCreateAgentPayload(state: WizardState) {
  const isManaged = state.mode === "managed";
  const langs = [state.primaryLanguage, ...state.additionalLanguages];
  const stack = getManagedStack(langs);

  if (isManaged) {
    const leadEnabled = state.leadSource.enabled;
    const wizardInputs = {
      useCase: state.useCase,
      role: state.useCaseRole,
      serviceDescription: state.useCaseService,
      agentName: state.agentName,
      companyName: state.companyName,
      agentDirection: state.agentDirection,
      languages: [state.primaryLanguage, ...state.additionalLanguages],
      callFlowDescription: state.callFlowDescription,
      productDetails: state.productDetails,
      ...(state.microAnswers && state.microAnswers.length > 0 && { microAnswers: state.microAnswers }),
      ...(state.jdFileContent && { jdFileContent: state.jdFileContent }),
      ...(state.jdFileName && { jdFileName: state.jdFileName }),
      ...(leadEnabled && {
        leadSourceType: state.leadSource.type,
        leadFields: state.leadSource.fields,
      }),
    } as Record<string, unknown>;
    return {
      wizardInputs,
      agentMode: "managed" as const,
      name: state.agentName || `${STEP_LABELS["use-case"]} Agent`,
      language: LANG_CODE_MAP[state.primaryLanguage] ?? "en-US",
      asrLanguage: ASR_LANG_CODE_MAP[state.primaryLanguage] ?? "en",
      asrProvider: stack.asrProvider,
      asrModel: stack.asrModel,
      llmProvider: stack.llmProvider,
      llmModel: stack.llmModel,
      ttsProvider: stack.ttsProvider,
      ttsModel: stack.ttsModel,
      ttsVoice: state.selectedVoiceId || ARUSHI_VOICE.id,
      telephonyProvider: stack.telephonyProvider,
      systemPrompt: state.generatedPrompt || state.callFlowDescription || "You are a helpful AI voice assistant.",
      maxDuration: 600,
      agentConfig: {
        summarizationEnabled: true,
        summarizationPrompt: "Summarize this call in 3 bullet points: 1) caller intent, 2) key information exchanged, 3) outcome or next step.",
        secondaryLanguages: state.additionalLanguages.map(l => ASR_LANG_CODE_MAP[l] ?? l),
        ...(state.additionalLanguages[0] && { secondaryLanguage: ASR_LANG_CODE_MAP[state.additionalLanguages[0]] ?? state.additionalLanguages[0] }),
      } as Record<string, unknown>,
      tools: state.callTransferEnabled && state.callTransferNumber.trim()
        ? [{ type: "call_transfer" as const, name: "transfer_to_human", description: "Transfer the call to a human agent when the caller requests it or when escalation is needed.", transferTo: state.callTransferNumber.trim() }]
        : [],
      ...(leadEnabled && {
        leadSourceType: state.leadSource.type,
        ...(state.leadSource.token.trim() && { leadSourceToken: state.leadSource.token.trim() }),
        leadFields: state.leadSource.fields,
        ...(state.productDetails.trim() && { productDetails: state.productDetails.trim() }),
      }),
    };
  }

  return {
    name: state.agentName || "New Assistant",
    asrProvider: state.byopAsr,
    llmProvider: state.byopLlm,
    ttsProvider: state.byopTts,
    telephonyProvider: state.byopTelephony,
    systemPrompt: state.byopPrompt,
    maxDuration: 300,
    agentConfig: {
      secondaryLanguages: state.additionalLanguages.map(l => ASR_LANG_CODE_MAP[l] ?? l),
      ...(state.additionalLanguages[0] && { secondaryLanguage: ASR_LANG_CODE_MAP[state.additionalLanguages[0]] ?? state.additionalLanguages[0] }),
    } as Record<string, unknown>,
  };
}

/* ── Step definitions ───────────────────────────────────────────────────── */
// Step order: use-case → details → language → [micro 5q] → [call flow] → requirements → knowledge → voice → skills
const MANAGED_STEPS = [
  "use-case", "details", "language", "requirements", "knowledge", "voice", "skills",
] as const;
type ManagedStep = typeof MANAGED_STEPS[number];

const STEP_LABELS: Record<ManagedStep, string> = {
  "use-case": "Use Case", details: "Agent Details", language: "Language",
  requirements: "Agent Instructions", knowledge: "Knowledge Base", voice: "Voice", skills: "Skills & Finish",
};

/* ── Animated step wrapper ──────────────────────────────────────────────── */
function SlideStep({ children, direction }: { children: React.ReactNode; direction: "forward" | "back" }) {
  const cls = direction === "forward"
    ? "animate-[slideInRight_0.35s_cubic-bezier(.22,1,.36,1)]"
    : "animate-[slideInLeft_0.35s_cubic-bezier(.22,1,.36,1)]";
  return <div className={cn("w-full", cls)}>{children}</div>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN WIZARD
═══════════════════════════════════════════════════════════════════════════ */
interface Props { open: boolean; onClose: () => void; onCreated: (id: number, navigateTo?: string) => void }

export function CreateAgentWizard({ open, onClose, onCreated }: Props) {
  const [state, setState]             = useState<WizardState>(INITIAL);
  const [stepIdx, setStepIdx]         = useState(0);
  const [direction, setDirection]     = useState<"forward" | "back">("forward");
  const [isGenerating, setGenerating] = useState(false);
  const [generateError, setGenError]  = useState("");
  const [detailsErrors, setDetailsErrors] = useState<{ agentName?: string; companyName?: string }>({});
  const [loadingVoices, setLoadVoices]= useState(false);
  const [voiceSource, setVoiceSource] = useState<"cartesia" | "browser">("browser");
  const [renderKey, setRenderKey]     = useState(0);

  /* micro-wizard state */
  const [microActive, setMicroActive]       = useState(false);
  const [microStep, setMicroStep]           = useState(0); // 0-4 = questions, 5 = call flow preview
  const [microDir, setMicroDir]             = useState<"forward" | "back">("forward");
  const [microAnswers, setMicroAnswers]     = useState<MicroAnswers>(MICRO_INIT);
  const [microRenderKey, setMicroRenderKey] = useState(0);

  /* call flow edit state */
  const [flowEditMode, setFlowEditMode]         = useState(false);
  const [flowEditText, setFlowEditText]         = useState("");
  const [confirmedFlowNodes, setConfirmedFlowNodes] = useState<FlowNode[] | null>(null);
  const [flowFetching, setFlowFetching]         = useState(false);
  const [flowFallback, setFlowFallback]         = useState<string | null>(null);

  /* lead field add state */
  const [addFieldInput, setAddFieldInput] = useState("");
  const [addFieldError, setAddFieldError] = useState("");

  function handleAddLeadField() {
    const raw = addFieldInput.trim();
    if (!raw) { setAddFieldError("Field name cannot be blank."); return; }
    const slug = raw.toLowerCase().replace(/\s+/g, "_");
    const allKnown = [...(DEFAULT_LEAD_FIELDS as readonly string[]), ...state.leadSource.customFields];
    if (allKnown.includes(slug)) {
      setAddFieldError(`"${slug}" is already in the list.`);
      return;
    }
    update({
      leadSource: {
        ...state.leadSource,
        customFields: [...state.leadSource.customFields, slug],
        fields: [...state.leadSource.fields, slug], // start checked
      },
    });
    setAddFieldInput("");
    setAddFieldError("");
  }

  const updateMicro = useCallback((patch: Partial<MicroAnswers>) =>
    setMicroAnswers(p => ({ ...p, ...patch })), []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const jdInputRef   = useRef<HTMLInputElement>(null);
  const { toast }    = useToast();
  const qc           = useQueryClient();
  const create       = useCreateAgent();
  const { getToken } = useAuth();

  const apiFetch = useCallback(async (path: string, init?: RequestInit): Promise<Response> => {
    const token = await getToken();
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(path, { ...init, headers, credentials: "include" });
  }, [getToken]);

  const { playing, preview, setVoicesRef } = useVoicePreview(apiFetch);

  const update = useCallback((patch: Partial<WizardState>) => setState(p => ({ ...p, ...patch })), []);

  useEffect(() => { setVoicesRef(state.voices); }, [state.voices]);

  /* close & reset */
  function handleClose() {
    setState(INITIAL); setStepIdx(0); create.reset();
    setMicroActive(false); setMicroStep(0); setMicroAnswers(MICRO_INIT);
    setFlowEditMode(false); setFlowEditText(""); setConfirmedFlowNodes(null);
    setFlowFetching(false); setFlowFallback(null);
    onClose();
  }

  /* call Gemini-backed call flow endpoint */
  async function generateCallFlowFromAnswers() {
    setFlowFetching(true);
    setFlowFallback(null);
    setConfirmedFlowNodes(null);
    try {
      const questions = MICRO_QUESTIONS[state.useCase] ?? [];
      const microQA = questions.map((q, i) => ({
        question: q.q,
        answer: (microAnswers.answers[i] ?? "").trim(),
      }));
      const res = await apiFetch("/api/wizard/generate-call-flow", {
        method: "POST",
        body: JSON.stringify({
          useCase: state.useCase,
          role: state.useCaseRole,
          companyName: state.companyName,
          agentName: state.agentName,
          agentDirection: state.agentDirection,
          languages: [state.primaryLanguage, ...state.additionalLanguages],
          microAnswers: microQA,
          ...(microAnswers.jdFileContent && { jdFileContent: microAnswers.jdFileContent }),
          ...(microAnswers.jdFileName && { jdFileName: microAnswers.jdFileName }),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { reason?: string };
        setFlowFallback(body?.reason ?? "network");
        return;
      }
      const data = await res.json() as {
        nodes: FlowNode[] | null;
        flowText?: string;
      };
      if (Array.isArray(data.nodes) && data.nodes.length > 0) {
        setConfirmedFlowNodes(data.nodes);
      } else {
        setFlowFallback("gemini_parse_failed");
      }
    } catch {
      setFlowFallback("network");
    } finally {
      setFlowFetching(false);
    }
  }

  /* micro-wizard: go to next/prev step */
  function microGo(delta: 1 | -1) {
    if (delta === -1 && flowEditMode) { setFlowEditMode(false); return; }
    // Entering Step 5 (preview) from Q5 → kick off Gemini call flow generation.
    if (delta === 1 && microStep === 4) {
      setMicroDir("forward");
      setMicroStep(5);
      setMicroRenderKey(k => k + 1);
      setFlowEditMode(false);
      setFlowEditText("");
      void generateCallFlowFromAnswers();
      return;
    }
    setMicroDir(delta === 1 ? "forward" : "back");
    setMicroStep(s => s + delta);
    setMicroRenderKey(k => k + 1);
    if (delta === 1) {
      setFlowEditMode(false);
      setFlowEditText("");
    }
  }

  /* micro-wizard: confirmed call flow → pre-fill requirements textarea, advance */
  function handleMicroConfirm() {
    // Guard: never advance without a Gemini-generated (or user-edited) flow.
    if (!confirmedFlowNodes || confirmedFlowNodes.length === 0) return;
    const nodes = confirmedFlowNodes;
    const flowText = nodesToText(nodes);
    // Persist the raw micro-answers (paired with the question text) so the
    // final agent prompt generation gets the same answers the call flow used.
    const questions = MICRO_QUESTIONS[state.useCase] ?? [];
    const microQA = questions.map((q, i) => ({
      question: q.q,
      answer: (microAnswers.answers[i] ?? "").trim(),
    }));
    update({
      callFlowDescription: flowText,
      microAnswers: microQA,
      jdFileContent: microAnswers.jdFileContent,
      jdFileName: microAnswers.jdFileName,
    });
    setMicroActive(false);
    setMicroStep(0);
    setMicroAnswers(MICRO_INIT);
    setConfirmedFlowNodes(null);
    setFlowEditMode(false);
    setFlowEditText("");
    setFlowFetching(false);
    setFlowFallback(null);
    go(1);
  }

  /* micro: is current step answered? */
  function microStepValid(): boolean {
    if (microStep >= 5) return true;
    if (microStep === 4) return true; // Q5 is always optional
    if (microStep === 0 && state.useCase === "candidate_screen") {
      return microAnswers.jdFileName.length > 0 || (microAnswers.answers[0]?.trim().length ?? 0) > 0;
    }
    return (microAnswers.answers[microStep]?.trim().length ?? 0) > 0;
  }

  /* keyboard: Esc */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  /* fetch Cartesia voices once */
  async function loadVoices() {
    if (state.voices.length > FALLBACK_VOICES.length) return;
    setLoadVoices(true);
    try {
      const baseLang = (LANG_CODE_MAP[state.primaryLanguage] ?? "en").split("-")[0];
      const res = await apiFetch(`/api/wizard/voices?language=${baseLang}`, { method: "GET" });
      if (res.ok) {
        const { voices, source } = await res.json() as { voices: CartesiaVoice[]; source: string };
        if (voices.length === 0) return;
        const langMatch    = voices.find(v => v.language === baseLang && baseLang !== "en");
        const defaultVoice = langMatch ?? voices[0]!;
        const rest         = voices.filter(v => v.id !== defaultVoice.id);
        update({ voices: [defaultVoice, ...rest], selectedVoiceId: defaultVoice.id });
        setVoiceSource(source === "cartesia" || source === "whitelist" ? "cartesia" : "browser");
      }
    } finally { setLoadVoices(false); }
  }

  /* navigate */
  function go(delta: 1 | -1) {
    setDirection(delta === 1 ? "forward" : "back");
    setStepIdx(i => i + delta);
    setRenderKey(k => k + 1);
    if (delta === 1 && state.mode === "managed" && MANAGED_STEPS[stepIdx + 1] === "voice") {
      void loadVoices();
    }
  }

  /* AI prompt generation — calls Gemini master template, creates agent, PATCHes systemPrompt */
  async function generatePrompt() {
    setGenerating(true);
    setGenError("");
    try {
      const langs = [state.primaryLanguage, ...state.additionalLanguages];

      // Step 1: generate the full system prompt from the master template
      const genRes = await apiFetch("/api/wizard/generate-master-prompt", {
        method: "POST",
        body: JSON.stringify({
          useCase: state.useCase,
          role: state.useCaseRole,
          companyName: state.companyName,
          agentName: state.agentName,
          serviceDescription: state.useCaseService,
          agentDirection: state.agentDirection,
          callFlowDescription: state.callFlowDescription,
          selectedLanguages: langs,
        }),
      });
      if (!genRes.ok) {
        const body = await genRes.json().catch(() => ({})) as any;
        throw new Error(body.error ?? `Prompt generation failed (HTTP ${genRes.status})`);
      }
      const genData = await genRes.json() as { systemPrompt: string };
      const systemPrompt = (genData.systemPrompt ?? "").trim();
      if (!systemPrompt) throw new Error("Gemini returned an empty prompt — please retry.");

      // Step 2: create the agent with the current wizard state
      const payload = buildCreateAgentPayload({ ...state, generatedPrompt: systemPrompt });
      const createRes = await apiFetch("/api/agents", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({})) as any;
        throw new Error(body.error ?? `Agent creation failed (HTTP ${createRes.status})`);
      }
      const created = await createRes.json() as { id: number; name: string };

      // Step 3: PATCH systemPrompt onto the newly created agent (belt-and-suspenders)
      await apiFetch(`/api/agents/${created.id}`, {
        method: "PATCH",
        body: JSON.stringify({ systemPrompt }),
      }).catch(() => {
        // Non-fatal: agent was created with the prompt already embedded; PATCH failure
        // just means the UI may not immediately reflect the stored value.
      });

      // Step 4: close wizard, navigate to agent Prompt tab
      qc.invalidateQueries({ queryKey: getListAgentsQueryKey() });
      toast({ title: `${created.name} is ready!` });
      setState(INITIAL); setStepIdx(0);
      onCreated(created.id, "prompt");
    } catch (err: any) {
      setGenError(err?.message ?? "Generation failed — you can still continue manually.");
    } finally { setGenerating(false); }
  }

  /* KB file read */
  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = e => update({ kbContent: e.target?.result as string, kbFileName: file.name });
    reader.readAsText(file);
  }

  /* JD file read (candidate screening) */
  function handleJDFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.name.endsWith(".txt") || file.name.endsWith(".md")) {
      const reader = new FileReader();
      reader.onload = ev => {
        const content = ev.target?.result as string;
        const next = [...microAnswers.answers];
        next[0] = content.slice(0, 2000);
        updateMicro({ jdFileContent: content, jdFileName: file.name, answers: next });
      };
      reader.readAsText(file);
    } else {
      // For PDF/DOCX, store filename; user fills text manually if needed
      updateMicro({ jdFileName: file.name, jdFileContent: `(${file.name} uploaded — describe key requirements in Option B if needed)` });
    }
    e.target.value = "";
  }

  /* create agent */
  async function handleCreate() {
    const payload = buildCreateAgentPayload(state);

    create.mutate({ data: payload as any }, {
      onSuccess: (created) => {
        qc.invalidateQueries({ queryKey: getListAgentsQueryKey() });
        toast({ title: `${created.name} is ready!` });
        setState(INITIAL); setStepIdx(0);
        onCreated(created.id);
      },
      onError: (err: unknown) => {
        const detail = formatApiError(err);
        toast({
          title: "Create failed",
          description: detail || undefined,
          variant: "destructive",
        });
      },
    });
  }

  if (!open) return null;

  const currentStep: ManagedStep | null = state.mode === "managed" ? (MANAGED_STEPS[stepIdx] ?? null) : null;
  const totalManagedSteps = MANAGED_STEPS.length;
  const progress = microActive
    ? ((microStep + 1) / 6) * 100
    : state.mode === "managed"
    ? ((stepIdx + 1) / totalManagedSteps) * 100
    : state.mode === "byop" ? 100 : 0;

  /* current call flow nodes for preview — only what Gemini returned (or the
   * user-edited version). No silent rule-based fallback. */
  const currentFlowNodes: FlowNode[] = confirmedFlowNodes ?? [];

  /* ────────────────────────────────────────────────────────────────────── */
  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-card flex flex-col overflow-hidden">

      <style>{`
        @keyframes slideInRight { from { opacity:0; transform:translateX(48px); } to { opacity:1; transform:translateX(0); } }
        @keyframes slideInLeft  { from { opacity:0; transform:translateX(-48px); } to { opacity:1; transform:translateX(0); } }
        @keyframes fadeUp       { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      {/* Progress bar */}
      <div className="h-0.5 bg-muted shrink-0">
        <div
          className="h-full bg-gradient-to-r from-zinc-500 to-zinc-400 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Top bar */}
      <div className="flex items-center justify-between px-8 pt-5 pb-3 shrink-0">
        <div className="flex items-center gap-3">
          {(state.mode !== null || microActive) && (
            <button
              onClick={() => {
                if (flowEditMode) { setFlowEditMode(false); return; }
                if (microActive) {
                  if (microStep > 0) microGo(-1);
                  else { setMicroActive(false); setMicroRenderKey(k => k + 1); }
                } else if (state.mode === "managed" && stepIdx > 0) go(-1);
                else { setState(INITIAL); setStepIdx(0); setRenderKey(k => k + 1); }
              }}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm"
            >
              <ChevronLeft className="h-4 w-4" /> {flowEditMode ? "Cancel edit" : "Back"}
            </button>
          )}
        </div>

        <div className="flex items-center gap-4">
          {microActive && (
            <span className="text-muted-foreground text-xs font-mono tracking-widest uppercase">
              {microStep < 5
                ? `${String(microStep + 1).padStart(2, "0")} / 05 — Question ${microStep + 1}`
                : flowEditMode ? "Call Flow — Edit Mode" : "Call Flow Preview"}
            </span>
          )}
          {!microActive && state.mode === "managed" && currentStep && (
            <span className="text-muted-foreground text-xs font-mono tracking-widest uppercase">
              {String(stepIdx + 1).padStart(2, "0")} / {String(totalManagedSteps).padStart(2, "0")} — {STEP_LABELS[currentStep]}
            </span>
          )}
          <button onClick={handleClose} className="h-8 w-8 rounded-full bg-muted hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-all">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="w-full max-w-2xl mx-auto min-h-full flex flex-col justify-center">

          {/* ── Domain micro-wizard ─────────────────────────────────────────── */}
          {microActive && (
            <SlideStep key={`micro-${microStep}-${microRenderKey}`} direction={microDir}>

              {/* Steps 0–4: domain-specific questions */}
              {microStep < 5 && (() => {
                const questions = MICRO_QUESTIONS[state.useCase] ?? [];
                const q = questions[microStep];
                if (!q) return null;

                /* Special: Candidate Screening Q0 — JD upload + manual text */
                if (q.type === "jd-upload") {
                  return (
                    <div>
                      <p className="text-muted-foreground text-xs uppercase tracking-[0.2em] mb-3">01 / 05</p>
                      <h2 className="text-3xl font-bold text-foreground mb-2">Job description &amp;<br />must-have skills</h2>
                      <p className="text-muted-foreground text-sm mb-8">{q.hint}</p>

                      <div className="mb-5">
                        <p className="text-muted-foreground text-xs uppercase tracking-[0.15em] mb-3 font-semibold">Option A — Upload JD file</p>
                        {microAnswers.jdFileName ? (
                          <div className="p-4 rounded-xl border border-zinc-300 bg-muted flex items-center gap-3">
                            <FileText className="h-5 w-5 text-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-foreground text-sm font-semibold truncate">{microAnswers.jdFileName}</p>
                              <p className="text-muted-foreground text-xs">Uploaded — add any extra notes in Option B if needed</p>
                            </div>
                            <button
                              onClick={() => updateMicro({ jdFileContent: "", jdFileName: "" })}
                              className="text-muted-foreground hover:text-muted-foreground transition-colors"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <div
                            className="border-2 border-dashed border-border rounded-2xl p-8 text-center hover:border-border transition-colors cursor-pointer group"
                            onClick={() => jdInputRef.current?.click()}
                          >
                            <div className="h-12 w-12 rounded-2xl bg-muted group-hover:bg-muted flex items-center justify-center mx-auto mb-3 transition-colors">
                              <Upload className="h-6 w-6 text-muted-foreground" />
                            </div>
                            <p className="text-muted-foreground font-semibold text-sm mb-1">Click to upload JD</p>
                            <p className="text-muted-foreground text-xs">PDF, DOCX, or TXT — max 5 MB</p>
                            <input ref={jdInputRef} type="file" accept=".txt,.pdf,.docx,.md" className="hidden" onChange={handleJDFile} />
                          </div>
                        )}
                      </div>

                      <p className="text-muted-foreground text-xs text-center mb-5">— or —</p>

                      <div>
                        <p className="text-muted-foreground text-xs uppercase tracking-[0.15em] mb-3 font-semibold">Option B — Type role &amp; requirements manually</p>
                        <div className="relative">
                          <VoiceInputButton
                            onTranscript={text => {
                              const next = [...microAnswers.answers];
                              const current = next[0] ?? "";
                              const sep = current && !/\s$/.test(current) ? " " : "";
                              next[0] = current + sep + text;
                              updateMicro({ answers: next });
                            }}
                          >
                            {({ recording, finalText, interimText }) =>
                              recording ? (
                                <div className="mb-2 max-h-32 overflow-y-auto rounded-xl border border-border bg-muted/50 px-4 py-2 text-sm leading-relaxed">
                                  {finalText && <span className="text-foreground">{finalText}</span>}
                                  {interimText && (
                                    <span className="text-muted-foreground/70">
                                      {finalText ? " " : ""}
                                      {interimText}
                                    </span>
                                  )}
                                  {!finalText && !interimText && (
                                    <span className="text-muted-foreground/70 italic">Listening…</span>
                                  )}
                                </div>
                              ) : null
                            }
                          </VoiceInputButton>
                          <textarea
                            rows={4}
                            placeholder={q.placeholder}
                            value={microAnswers.answers[0] ?? ""}
                            onChange={e => {
                              const next = [...microAnswers.answers];
                              next[0] = e.target.value;
                              updateMicro({ answers: next });
                            }}
                            className="w-full bg-muted border border-border rounded-xl px-4 pt-3.5 pb-11 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-all resize-none leading-relaxed"
                          />
                        </div>
                      </div>
                    </div>
                  );
                }

                /* Standard textarea question */
                return (
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-[0.2em] mb-3">
                      {String(microStep + 1).padStart(2, "0")} / 05
                    </p>
                    <h2 className="text-3xl font-bold text-foreground mb-2">{q.q}</h2>
                    <p className="text-muted-foreground text-sm mb-8">{q.hint}</p>
                    <div className="relative">
                      <VoiceInputButton
                        onTranscript={text => {
                          const next = [...microAnswers.answers];
                          const current = next[microStep] ?? "";
                          const sep = current && !/\s$/.test(current) ? " " : "";
                          next[microStep] = current + sep + text;
                          updateMicro({ answers: next });
                        }}
                      >
                        {({ recording, finalText, interimText }) =>
                          recording ? (
                            <div className="mb-2 max-h-32 overflow-y-auto rounded-xl border border-border bg-muted/50 px-4 py-2 text-sm leading-relaxed">
                              {finalText && <span className="text-foreground">{finalText}</span>}
                              {interimText && (
                                <span className="text-muted-foreground/70">
                                  {finalText ? " " : ""}
                                  {interimText}
                                </span>
                              )}
                              {!finalText && !interimText && (
                                <span className="text-muted-foreground/70 italic">Listening…</span>
                              )}
                            </div>
                          ) : null
                        }
                      </VoiceInputButton>
                      <textarea
                        autoFocus
                        rows={5}
                        placeholder={q.placeholder}
                        value={microAnswers.answers[microStep] ?? ""}
                        onChange={e => {
                          const next = [...microAnswers.answers];
                          next[microStep] = e.target.value;
                          updateMicro({ answers: next });
                        }}
                        className="w-full bg-muted border border-border rounded-xl px-4 pt-3.5 pb-11 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-all resize-none leading-relaxed"
                      />
                    </div>
                    {microStep === 4 && (
                      <p className="text-muted-foreground text-xs mt-2">Optional — leave blank and continue to proceed with default handling.</p>
                    )}
                  </div>
                );
              })()}

              {/* Step 5: Call Flow Preview */}
              {microStep === 5 && (() => {
                if (flowEditMode) {
                  return (
                    <div>
                      <p className="text-muted-foreground text-xs uppercase tracking-[0.2em] mb-3">Call Flow — Edit Mode</p>
                      <h2 className="text-3xl font-bold text-foreground mb-2">Edit your call flow</h2>
                      <p className="text-muted-foreground text-sm mb-6">
                        Edit each step below — one step per line. Lines starting with → are branch paths. Use <code className="bg-muted px-1 rounded text-xs">[Badge]</code> at the end of a line to add a tag.
                      </p>
                      <textarea
                        autoFocus
                        rows={14}
                        value={flowEditText}
                        onChange={e => setFlowEditText(e.target.value)}
                        className="w-full bg-muted border border-zinc-300 rounded-xl px-4 py-3.5 text-foreground text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-all resize-none leading-relaxed"
                      />
                    </div>
                  );
                }

                return (
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-[0.2em] mb-3">Step 5 of 9 — Call Flow Preview</p>
                    <h2 className="text-3xl font-bold text-foreground mb-2">Here's how your<br />agent will run</h2>
                    <p className="text-muted-foreground text-sm mb-7">
                      This call flow was built from your answers. Review it carefully — click <strong className="text-muted-foreground">Edit this flow</strong> to make changes, or continue when it looks right.
                    </p>

                    {flowFetching && (
                      <div className="mb-6 flex items-center gap-3 text-gray-500 text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating your call flow from your answers…
                      </div>
                    )}

                    {!flowFetching && flowFallback && (() => {
                      const COPY: Record<string, { title: string; body: string }> = {
                        gemini_key_missing: {
                          title: "AI call-flow generation isn't configured",
                          body: "The Gemini API key has not been set. Ask an administrator to add it in the Admin panel under Managed Stack Keys.",
                        },
                        no_active_template: {
                          title: "Master prompt template is missing",
                          body: "No active master prompt template is configured. An administrator needs to upload and activate a master template before the call flow can be generated.",
                        },
                        gemini_request_failed: {
                          title: "Gemini request failed",
                          body: "We couldn't reach the Gemini API to build your call flow. This may be a transient network or upstream issue — please retry.",
                        },
                        gemini_parse_failed: {
                          title: "Couldn't parse Gemini's response",
                          body: "Gemini returned a response we couldn't read as a valid call flow. Please retry — most retries succeed.",
                        },
                        network: {
                          title: "Couldn't reach the server",
                          body: "The request to generate your call flow failed. Check your connection and retry.",
                        },
                      };
                      const c = COPY[flowFallback] ?? COPY.network!;
                      return (
                        <div className="mb-5 px-4 py-4 rounded-xl border border-red-200 bg-red-50 text-red-800 text-sm leading-relaxed">
                          <p className="font-semibold mb-1">{c.title}</p>
                          <p className="text-red-700 text-xs mb-3">{c.body}</p>
                          <button
                            onClick={() => { void generateCallFlowFromAnswers(); }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors"
                          >
                            <RefreshCw className="h-3.5 w-3.5" /> Retry
                          </button>
                        </div>
                      );
                    })()}

                    {/* Flow nodes */}
                    <div className={cn("relative pl-5", flowFetching && "opacity-40 pointer-events-none")}>
                      <div className="absolute left-0 top-2 bottom-2 w-px bg-muted" />
                      {currentFlowNodes.map((node, i) => (
                        <div key={i} className={cn("relative mb-5 last:mb-0", node.branch && "ml-5")}>
                          <div className={cn(
                            "absolute -left-5 top-[7px] h-2.5 w-2.5 rounded-full border-2",
                            node.branch ? "border-border bg-card" : "border-zinc-400 bg-zinc-400",
                          )} />
                          <div className="pl-3">
                            <p className={cn(
                              "text-sm leading-snug",
                              node.branch ? "text-muted-foreground font-normal" : "text-foreground font-medium",
                            )}>
                              {node.label}
                            </p>
                            {node.badge && (
                              <span className="inline-block mt-1.5 px-2.5 py-0.5 text-[10px] font-semibold rounded-full bg-muted text-foreground border border-border leading-normal">
                                {node.badge}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

            </SlideStep>
          )}

          {!microActive && (
          <SlideStep key={`${state.mode}-${stepIdx}-${renderKey}`} direction={direction}>

            {/* ── Mode selection ── */}
            {state.mode === null && (
              <div className="animate-[fadeUp_0.4s_ease-out]">
                <p className="text-muted-foreground text-xs uppercase tracking-[0.2em] mb-3">Get started</p>
                <h1 className="text-4xl font-bold text-foreground mb-2 leading-tight">How do you want to<br />build your agent?</h1>
                <p className="text-muted-foreground text-base mb-10">Choose your setup mode — you can always change provider settings later.</p>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => { update({ mode: "managed" }); setDirection("forward"); setRenderKey(k => k + 1); }}
                    className="group relative text-left p-6 rounded-2xl border border-zinc-600/50 transition-all duration-200"
                    style={{ background: "linear-gradient(135deg, #4a4a52 0%, #3e3e46 100%)" }}
                  >
                    <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "linear-gradient(135deg, #55555e 0%, #47474f 100%)" }} />
                    <div className="relative">
                      <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-zinc-500 to-zinc-600 flex items-center justify-center mb-4 shadow-lg shadow-zinc-500/30">
                        <Wand2 className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="font-bold text-foreground text-lg">Managed</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-foreground font-semibold border border-zinc-300">Recommended</span>
                      </div>
                      <p className="text-muted-foreground text-sm leading-relaxed">We handle the full AI stack. Just describe what your agent should do.</p>
                      <div className="mt-4 flex items-center gap-1.5 text-foreground text-sm font-medium group-hover:gap-2.5 transition-all">
                        Get started <ChevronRight className="h-4 w-4" />
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => { update({ mode: "byop" }); setDirection("forward"); setRenderKey(k => k + 1); }}
                    className="group relative text-left p-6 rounded-2xl border border-border bg-muted hover:bg-muted hover:border-border transition-all duration-200"
                  >
                    <div className="relative">
                      <div className="h-11 w-11 rounded-xl bg-muted flex items-center justify-center mb-4">
                        <Globe className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="mb-1.5">
                        <span className="font-bold text-foreground text-lg">BYOP</span>
                        <span className="ml-2 text-muted-foreground text-sm">Bring Your Own Providers</span>
                      </div>
                      <p className="text-muted-foreground text-sm leading-relaxed">Choose your own ASR, LLM, TTS and telephony. Full control.</p>
                      <div className="mt-4 flex items-center gap-1.5 text-muted-foreground text-sm font-medium group-hover:gap-2.5 transition-all">
                        Configure manually <ChevronRight className="h-4 w-4" />
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* ════════════════════════════════════════════
                MANAGED STEPS
            ════════════════════════════════════════════ */}

            {/* Step 1: Use Case */}
            {currentStep === "use-case" && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-[0.2em] mb-3">Step 1 of 9</p>
                <h2 className="text-3xl font-bold text-foreground mb-2">What type of agent<br />do you need?</h2>
                <p className="text-muted-foreground text-sm mb-8">Select the use case that best matches your goal.</p>

                <div className="grid grid-cols-2 gap-2.5">
                  {USE_CASES.map(uc => {
                    const Icon = uc.icon;
                    const sel  = state.useCase === uc.id;
                    return (
                      <button
                        key={uc.id}
                        onClick={() => { update({ useCase: uc.id, useCaseRole: uc.role, useCaseService: uc.service }); }}
                        className={cn(
                          "text-left p-4 rounded-xl border transition-all duration-200 flex items-center gap-3 group",
                          sel
                            ? "border-zinc-400 bg-muted shadow-[0_0_0_1px_rgba(99,102,241,0.3)]"
                            : "border-border bg-muted hover:border-border hover:bg-muted",
                        )}
                      >
                        <div className={cn(
                          "h-9 w-9 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                          sel ? "bg-zinc-500 text-white" : "bg-muted text-muted-foreground",
                        )}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className={cn("font-semibold text-sm", sel ? "text-foreground" : "text-muted-foreground")}>{uc.label}</div>
                          <div className="text-xs text-muted-foreground mt-0.5 leading-tight truncate">{uc.desc}</div>
                        </div>
                        {sel && <Check className="h-4 w-4 text-foreground shrink-0 ml-auto" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 2: Agent Details */}
            {currentStep === "details" && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-[0.2em] mb-3">Step 2 of 9</p>
                <h2 className="text-3xl font-bold text-foreground mb-2">Tell us about<br />your agent</h2>
                <p className="text-muted-foreground text-sm mb-8">Basic details that personalise the agent's identity.</p>

                <div className="space-y-5">
                  <div>
                    <label className="text-muted-foreground text-xs uppercase tracking-[0.15em] block mb-2">Agent's name</label>
                    <input
                      type="text"
                      placeholder="e.g. Arushi, Priya, Alex"
                      value={state.agentName}
                      onChange={e => { update({ agentName: e.target.value }); if (e.target.value.trim()) setDetailsErrors(prev => ({ ...prev, agentName: undefined })); }}
                      className={cn(
                        "w-full bg-muted border rounded-xl px-4 py-3.5 text-foreground text-base placeholder:text-muted-foreground focus:outline-none focus:bg-muted transition-all",
                        detailsErrors.agentName ? "border-foreground focus:border-foreground" : "border-border focus:border-foreground",
                      )}
                    />
                    {detailsErrors.agentName && (
                      <p className="mt-1.5 text-xs text-foreground">{detailsErrors.agentName}</p>
                    )}
                  </div>
                  <div>
                    <label className="text-muted-foreground text-xs uppercase tracking-[0.15em] block mb-2">Company name</label>
                    <input
                      type="text"
                      placeholder="e.g. QuickPay, Acme Corp"
                      value={state.companyName}
                      onChange={e => { update({ companyName: e.target.value }); if (e.target.value.trim()) setDetailsErrors(prev => ({ ...prev, companyName: undefined })); }}
                      className={cn(
                        "w-full bg-muted border rounded-xl px-4 py-3.5 text-foreground text-base placeholder:text-muted-foreground focus:outline-none focus:bg-muted transition-all",
                        detailsErrors.companyName ? "border-foreground focus:border-foreground" : "border-border focus:border-foreground",
                      )}
                    />
                    {detailsErrors.companyName && (
                      <p className="mt-1.5 text-xs text-foreground">{detailsErrors.companyName}</p>
                    )}
                  </div>
                  <div>
                    <label className="text-muted-foreground text-xs uppercase tracking-[0.15em] block mb-3">Call direction</label>
                    <div className="flex gap-3">
                      {(["inbound", "outbound", "both"] as AgentDirection[]).map(dir => (
                        <button
                          key={dir}
                          onClick={() => update({ agentDirection: dir })}
                          className={cn(
                            "flex-1 py-3 px-4 rounded-xl border font-medium text-sm capitalize transition-all",
                            state.agentDirection === dir
                              ? "border-zinc-400 bg-muted text-foreground"
                              : "border-border bg-muted text-muted-foreground hover:border-border",
                          )}
                        >
                          {dir}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Lead Source ─────────────────────────────────── */}
                  <div className="rounded-xl border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => update({ leadSource: { ...state.leadSource, enabled: !state.leadSource.enabled } })}
                      className="w-full flex items-center justify-between px-4 py-3.5 bg-muted hover:bg-muted transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-2 h-2 rounded-full",
                          state.leadSource.enabled ? "bg-zinc-500" : "bg-muted",
                        )} />
                        <span className="text-muted-foreground text-xs uppercase tracking-[0.15em] font-medium">Lead Source</span>
                        {state.leadSource.enabled && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground bg-muted border border-border px-1.5 py-0.5 rounded-full">On</span>
                        )}
                      </div>
                      <span className="text-muted-foreground text-xs">{state.leadSource.enabled ? "▲" : "▼"}</span>
                    </button>

                    {state.leadSource.enabled && (
                      <div className="px-4 pb-4 pt-3 space-y-4 bg-card">
                        {/* Source type */}
                        <div>
                          <label className="text-muted-foreground text-xs uppercase tracking-[0.15em] block mb-2">Source</label>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-2 flex-1 px-4 py-2.5 rounded-xl border border-zinc-300 bg-muted">
                              <svg viewBox="0 0 24 24" className="h-4 w-4 text-foreground shrink-0" fill="currentColor">
                                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                              </svg>
                              <span className="text-sm text-foreground font-medium">Instagram</span>
                            </div>
                          </div>
                        </div>

                        {/* Page Access Token */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-muted-foreground text-xs uppercase tracking-[0.15em]">Page Access Token</label>
                            <a
                              href="https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-access-tokens-and-permissions"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] text-zinc-500 hover:text-foreground underline"
                            >
                              Get token ↗
                            </a>
                          </div>
                          <input
                            type="password"
                            placeholder="EAAxxxxxxxxxxxxxxxxxxxxxxxx"
                            value={state.leadSource.token}
                            onChange={e => update({ leadSource: { ...state.leadSource, token: e.target.value } })}
                            className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-all font-mono"
                          />
                        </div>

                        {/* Lead fields checklist */}
                        <div>
                          <label className="text-muted-foreground text-xs uppercase tracking-[0.15em] block mb-2">Lead Fields to Capture</label>
                          <div className="flex gap-2 flex-wrap mb-3">
                            {/* Default fields — always visible, togglable on/off */}
                            {(DEFAULT_LEAD_FIELDS as readonly string[]).map(field => {
                              const checked = state.leadSource.fields.includes(field);
                              const varName = `{{lead_${field}}}`;
                              return (
                                <button
                                  key={field}
                                  type="button"
                                  onClick={() => {
                                    const next = checked
                                      ? state.leadSource.fields.filter(f => f !== field)
                                      : [...state.leadSource.fields, field];
                                    update({ leadSource: { ...state.leadSource, fields: next } });
                                  }}
                                  className={cn(
                                    "flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all",
                                    checked
                                      ? "border-zinc-400 bg-muted text-foreground"
                                      : "border-border bg-muted text-muted-foreground hover:border-border",
                                  )}
                                >
                                  <span className={cn("w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0", checked ? "border-zinc-500 bg-zinc-500" : "border-border")}>
                                    {checked && <Check className="h-2.5 w-2.5 text-white" />}
                                  </span>
                                  <span className="capitalize">{field}</span>
                                  <span className={cn("font-mono text-[10px]", checked ? "text-zinc-500" : "text-muted-foreground")}>{varName}</span>
                                </button>
                              );
                            })}
                            {/* Custom fields — togglable + removable */}
                            {state.leadSource.customFields.map(field => {
                              const checked = state.leadSource.fields.includes(field);
                              const varName = `{{lead_${field}}}`;
                              const displayName = field.replace(/_/g, " ");
                              return (
                                <span
                                  key={field}
                                  className={cn(
                                    "flex items-center gap-1.5 pl-3 pr-2 py-2 rounded-xl border text-xs font-medium transition-all",
                                    checked
                                      ? "border-zinc-400 bg-muted text-foreground"
                                      : "border-border bg-muted text-muted-foreground",
                                  )}
                                >
                                  {/* toggle button */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const next = checked
                                        ? state.leadSource.fields.filter(f => f !== field)
                                        : [...state.leadSource.fields, field];
                                      update({ leadSource: { ...state.leadSource, fields: next } });
                                    }}
                                    className={cn("w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 transition-colors", checked ? "border-zinc-500 bg-zinc-500" : "border-border hover:border-border")}
                                  >
                                    {checked && <Check className="h-2.5 w-2.5 text-white" />}
                                  </button>
                                  <span className="capitalize">{displayName}</span>
                                  <span className={cn("font-mono text-[10px]", checked ? "text-zinc-500" : "text-muted-foreground")}>{varName}</span>
                                  {/* remove button */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      update({
                                        leadSource: {
                                          ...state.leadSource,
                                          customFields: state.leadSource.customFields.filter(f => f !== field),
                                          fields: state.leadSource.fields.filter(f => f !== field),
                                        },
                                      });
                                    }}
                                    className="ml-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                    title={`Remove ${displayName}`}
                                  >
                                    <X className="h-2.5 w-2.5" />
                                  </button>
                                </span>
                              );
                            })}
                          </div>

                          {/* Add custom field */}
                          <div className="flex gap-2 items-center">
                            <input
                              type="text"
                              placeholder="e.g. Phone Number"
                              value={addFieldInput}
                              onChange={e => { setAddFieldInput(e.target.value); setAddFieldError(""); }}
                              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddLeadField(); } }}
                              className="flex-1 bg-muted border border-border rounded-xl px-3 py-2 text-foreground text-xs placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-all"
                            />
                            <button
                              type="button"
                              onClick={handleAddLeadField}
                              className="px-3 py-2 rounded-xl border border-zinc-300 bg-muted text-foreground text-xs font-medium hover:bg-muted transition-colors shrink-0"
                            >
                              Add field
                            </button>
                          </div>
                          {addFieldError && (
                            <p className="mt-1.5 text-[11px] text-foreground">{addFieldError}</p>
                          )}
                        </div>

                        {/* Product Details */}
                        <div>
                          <label className="text-muted-foreground text-xs uppercase tracking-[0.15em] block mb-2">Product Details</label>
                          <textarea
                            placeholder="Describe what you're selling — e.g. 3BHK apartments in Whitefield starting ₹80L, ready to move in..."
                            value={state.productDetails}
                            onChange={e => update({ productDetails: e.target.value })}
                            rows={3}
                            className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-all resize-none leading-relaxed"
                          />
                          <p className="mt-1.5 text-[11px] text-muted-foreground">Available as <code className="font-mono">&#123;&#123;product_details&#125;&#125;</code> in your agent's prompt.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Language */}
            {currentStep === "language" && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-[0.2em] mb-3">Step 3 of 9</p>
                <h2 className="text-3xl font-bold text-foreground mb-2">What language will<br />your agent speak?</h2>
                <p className="text-muted-foreground text-sm mb-8">English is always available. Add regional languages for Indian markets.</p>

                <div className="flex gap-3 mb-6">
                  {[
                    { value: false, label: "Single language",  sub: "One language only" },
                    { value: true,  label: "Multilingual",     sub: "English + up to 2 regional" },
                  ].map(opt => {
                    const sel = state.isMultilingual === opt.value;
                    return (
                      <button
                        key={String(opt.value)}
                        onClick={() => update({ isMultilingual: opt.value, additionalLanguages: [] })}
                        className={cn(
                          "flex-1 p-4 rounded-xl border transition-all flex items-start gap-3",
                          sel ? "border-zinc-400 bg-muted" : "border-border bg-muted hover:border-border",
                        )}
                      >
                        {opt.value ? <Languages className={cn("h-5 w-5 mt-0.5 shrink-0", sel ? "text-foreground" : "text-muted-foreground")} /> : <Volume2 className={cn("h-5 w-5 mt-0.5 shrink-0", sel ? "text-foreground" : "text-muted-foreground")} />}
                        <div className="text-left">
                          <div className={cn("font-semibold text-sm", sel ? "text-foreground" : "text-muted-foreground")}>{opt.label}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{opt.sub}</div>
                        </div>
                        {sel && <Check className="h-4 w-4 text-foreground ml-auto mt-0.5" />}
                      </button>
                    );
                  })}
                </div>

                <p className="text-muted-foreground text-xs uppercase tracking-[0.15em] mb-3">{state.isMultilingual ? "Primary language" : "Select language"}</p>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {LANGUAGES.map(lang => {
                    const sel = state.primaryLanguage === lang.code;
                    return (
                      <button
                        key={lang.code}
                        onClick={() => update({ primaryLanguage: lang.code })}
                        className={cn(
                          "p-3 rounded-xl border flex items-center gap-2.5 transition-all",
                          sel ? "border-zinc-400 bg-muted" : "border-border bg-muted hover:border-border",
                        )}
                      >
                        <span className={cn("font-medium text-sm", sel ? "text-foreground" : "text-muted-foreground")}>{lang.label}</span>
                        {sel && <Check className="h-3.5 w-3.5 text-foreground ml-auto" />}
                      </button>
                    );
                  })}
                </div>

                {state.isMultilingual && (
                  <>
                    <p className="text-muted-foreground text-xs uppercase tracking-[0.15em] mb-3">Additional regional languages <span className="text-muted-foreground normal-case">(up to 2)</span></p>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {LANGUAGES.filter(l => l.code !== state.primaryLanguage).map(lang => {
                        const sel   = state.additionalLanguages.includes(lang.code);
                        const maxed = state.additionalLanguages.length >= 2 && !sel;
                        return (
                          <button
                            key={lang.code}
                            disabled={maxed}
                            onClick={() => {
                              const next = sel
                                ? state.additionalLanguages.filter(c => c !== lang.code)
                                : [...state.additionalLanguages, lang.code];
                              update({ additionalLanguages: next });
                            }}
                            className={cn(
                              "p-3 rounded-xl border flex items-center gap-2.5 transition-all",
                              sel    ? "border-zinc-400 bg-muted"
                              : maxed ? "border-border opacity-30 cursor-not-allowed"
                              : "border-border bg-muted hover:border-border",
                            )}
                          >
                            <span className={cn("font-medium text-sm", sel ? "text-foreground" : "text-muted-foreground")}>{lang.label}</span>
                            {sel && <Check className="h-3.5 w-3.5 text-foreground ml-auto" />}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                {(() => {
                  const langs = [state.primaryLanguage, ...state.additionalLanguages];
                  const stack = getManagedStack(langs);
                  const hasTamil = langs.includes("tamil");
                  const hasIndic = langs.some(l => ["hindi","telugu","kannada","marathi","gujarati","bengali","malayalam"].includes(l));
                  return (
                    <div className="p-4 rounded-xl border border-border bg-muted">
                      <p className="text-muted-foreground text-xs uppercase tracking-[0.15em] mb-2">Auto-selected AI stack</p>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { l: "STT",  v: stack.asrProvider,       note: hasTamil ? "Tamil optimised" : "" },
                          { l: "LLM",  v: (hasTamil || hasIndic) ? "Gemini 2.5 Flash" : "Sarvam M1", note: (hasTamil || hasIndic) ? "Multilingual & fast" : "Indian language optimised" },
                          { l: "TTS",  v: "Cartesia Sonic", note: "" },
                          { l: "TEL",  v: stack.telephonyProvider,  note: "" },
                        ].map(item => (
                          <div key={item.l} className="text-center p-2.5 rounded-lg bg-muted border border-border">
                            <div className="text-muted-foreground text-[9px] uppercase tracking-widest">{item.l}</div>
                            <div className="text-foreground text-xs font-semibold capitalize mt-0.5">{item.v}</div>
                            {item.note && <div className="text-foreground/70 text-[9px] mt-0.5">{item.note}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Step 6: Agent Instructions (pre-filled from call flow) */}
            {currentStep === "requirements" && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-[0.2em] mb-3">Step 6 of 9</p>
                <h2 className="text-3xl font-bold text-foreground mb-2">Refine your agent's<br />instructions</h2>
                <p className="text-muted-foreground text-sm mb-6">
                  Your call flow has been pre-filled below. Edit it if needed, then generate an AI prompt or continue directly.
                </p>

                <textarea
                  placeholder={"The call flow from your answers will appear here automatically. You can also describe additional rules or scenarios here."}
                  value={state.callFlowDescription}
                  onChange={e => { update({ callFlowDescription: e.target.value }); setGenError(""); }}
                  rows={7}
                  className="w-full bg-muted border border-border rounded-xl px-4 py-3.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-all resize-none leading-relaxed mb-3"
                />

                <button
                  onClick={generatePrompt}
                  disabled={!state.callFlowDescription.trim() || isGenerating}
                  className={cn(
                    "w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl font-semibold text-sm transition-all mb-3",
                    !state.callFlowDescription.trim() || isGenerating
                      ? "bg-muted text-muted-foreground cursor-not-allowed"
                      : "bg-gradient-to-r from-zinc-600 to-zinc-600 hover:from-zinc-500 hover:to-zinc-500 text-white shadow-lg shadow-zinc-500/20",
                  )}
                >
                  {isGenerating
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating your prompt — this takes a few seconds...</>
                    : <><Sparkles className="h-4 w-4" /> Generate AI Prompt &amp; Continue</>
                  }
                </button>

                {generateError && (
                  <div className="flex items-start gap-2.5 p-3.5 rounded-xl border border-zinc-300 bg-muted mb-3">
                    <X className="h-4 w-4 text-zinc-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-zinc-500 text-xs font-semibold mb-0.5">Generation failed</p>
                      <p className="text-muted-foreground text-xs">{generateError}</p>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => go(1)}
                  disabled={!state.callFlowDescription.trim()}
                  className={cn(
                    "w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm border transition-all",
                    !state.callFlowDescription.trim()
                      ? "border-border text-muted-foreground cursor-not-allowed"
                      : "border-border text-muted-foreground hover:text-muted-foreground hover:border-border",
                  )}
                >
                  <SkipForward className="h-3.5 w-3.5" /> Skip AI generation &amp; continue manually
                </button>

                <p className="text-muted-foreground text-xs text-center mt-3">
                  You can edit or write the system prompt manually on the agent settings page.
                </p>
              </div>
            )}

            {/* Step 7: Knowledge Base */}
            {currentStep === "knowledge" && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-[0.2em] mb-3">Step 7 of 9</p>
                <h2 className="text-3xl font-bold text-foreground mb-2">Add a knowledge<br />base <span className="text-muted-foreground">(optional)</span></h2>
                <p className="text-muted-foreground text-sm mb-8">
                  Upload FAQs, product info, or any text your agent should know. The agent references this during calls. You can skip and add it later.
                </p>

                {!state.kbContent ? (
                  <div
                    className="border-2 border-dashed border-border rounded-2xl p-10 text-center hover:border-border transition-colors cursor-pointer group"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                  >
                    <div className="h-14 w-14 rounded-2xl bg-muted group-hover:bg-muted flex items-center justify-center mx-auto mb-4 transition-colors">
                      <Upload className="h-7 w-7 text-muted-foreground" />
                    </div>
                    <p className="text-muted-foreground font-semibold mb-1">Drop a file or click to upload</p>
                    <p className="text-muted-foreground text-sm">TXT, PDF, DOCX — max 5 MB</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.pdf,.docx,.md,.csv"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                    />
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-zinc-300 bg-muted flex items-center gap-3 mb-4">
                    <FileText className="h-5 w-5 text-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground text-sm font-semibold truncate">{state.kbFileName || "Pasted content"}</p>
                      <p className="text-muted-foreground text-xs">{state.kbContent.length.toLocaleString()} characters</p>
                    </div>
                    <button onClick={() => update({ kbContent: "", kbFileName: "" })} className="text-muted-foreground hover:text-muted-foreground transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                <p className="text-muted-foreground text-xs text-center my-4">— or —</p>

                <textarea
                  placeholder="Paste your FAQs, product description, pricing, or any knowledge here..."
                  value={state.kbContent && !state.kbFileName ? state.kbContent : ""}
                  onChange={e => update({ kbContent: e.target.value, kbFileName: "" })}
                  rows={5}
                  className="w-full bg-muted border border-border rounded-xl px-4 py-3.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-all resize-none leading-relaxed"
                />

                <div className="mt-4 p-3.5 rounded-xl border border-border bg-muted flex items-center gap-2.5">
                  <SkipForward className="h-4 w-4 text-muted-foreground shrink-0" />
                  <p className="text-muted-foreground text-xs">You can skip this step and add a knowledge base later from the agent settings.</p>
                </div>
              </div>
            )}

            {/* Step 8: Voice */}
            {currentStep === "voice" && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-[0.2em] mb-3">Step 8 of 9</p>
                <h2 className="text-3xl font-bold text-foreground mb-2">Choose your<br />agent's voice</h2>
                <p className="text-muted-foreground text-sm mb-8">
                  {state.primaryLanguage !== "english"
                    ? <><span className="text-foreground font-medium">A native {state.primaryLanguage} voice is pre-selected</span> — voices with a matching language badge work best.{" "}</>
                    : <><span className="text-foreground font-medium">Arushi</span> is pre-selected — warm Indian English female.{" "}</>
                  }
                  {voiceSource === "cartesia"
                    ? "Press ▶ to hear any voice."
                    : <span className="text-zinc-500">Preview plays your browser's built-in voice (Cartesia key not configured).</span>}
                </p>

                {loadingVoices ? (
                  <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" /> Loading voices...
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5">
                    {state.voices.map(voice => {
                      const sel      = state.selectedVoiceId === voice.id;
                      const isPlay   = playing === voice.id;
                      const isArushi = voice.name.toLowerCase().includes("arushi");
                      return (
                        <div
                          key={voice.id}
                          onClick={() => update({ selectedVoiceId: voice.id })}
                          className={cn(
                            "p-4 rounded-xl border cursor-pointer transition-all duration-200 flex items-center gap-3 group",
                            sel
                              ? "border-zinc-400 bg-muted"
                              : "border-border bg-muted hover:border-border hover:bg-muted",
                          )}
                        >
                          <div className="h-11 w-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0 bg-muted text-foreground">
                            {voice.name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={cn("font-semibold text-sm", sel ? "text-foreground" : "text-muted-foreground")}>{voice.name}</span>
                              {isArushi && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-foreground font-semibold">Default</span>}
                              {voice.language && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                                  {LANG_LABEL[voice.language] ?? voice.language.toUpperCase()}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5 truncate">{voice.description}</div>
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); void preview(voice.id); }}
                            className={cn(
                              "h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-all",
                              isPlay ? "bg-zinc-500 text-white" : "bg-muted text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                          >
                            {isPlay ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                          </button>
                          {sel && <Check className="h-4 w-4 text-foreground shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Step 9: Skills & Finish */}
            {currentStep === "skills" && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-[0.2em] mb-3">Step 9 — Final step</p>
                <h2 className="text-3xl font-bold text-foreground mb-2">Agent skills &amp;<br />final setup</h2>
                <p className="text-muted-foreground text-sm mb-8">Enable capabilities your agent needs. Auto-summarize is always on.</p>

                <div className="space-y-4">
                  {/* Call Transfer */}
                  <div className={cn(
                    "p-5 rounded-xl border transition-all",
                    state.callTransferEnabled ? "border-border bg-muted/60" : "border-border bg-card",
                  )}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2.5">
                        <PhoneForwarded className={cn("h-4 w-4", state.callTransferEnabled ? "text-foreground" : "text-muted-foreground")} />
                        <span className="font-semibold text-foreground text-sm">Call Transfer</span>
                      </div>
                      <Switch
                        checked={state.callTransferEnabled}
                        onCheckedChange={v => update({ callTransferEnabled: v })}
                      />
                    </div>
                    <p className="text-muted-foreground text-xs mb-3">Agent can transfer calls to a human agent when needed</p>
                    {state.callTransferEnabled && (
                      <input
                        type="tel"
                        placeholder="+91 9876543210"
                        value={state.callTransferNumber}
                        onChange={e => update({ callTransferNumber: e.target.value })}
                        className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-zinc-400 transition-all"
                      />
                    )}
                  </div>

                  {/* Auto Summarize — always on */}
                  <div className="p-5 rounded-xl border border-border bg-muted flex items-start gap-3">
                    <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                      <Check className="h-4 w-4 text-foreground" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-semibold text-foreground text-sm">Auto-Summarize Calls</span>
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-muted text-foreground font-semibold border border-border">Always On</span>
                      </div>
                      <p className="text-muted-foreground text-xs leading-relaxed">After each call, AI generates a 3-bullet summary — caller intent, key info exchanged, and outcome.</p>
                    </div>
                  </div>

                  {/* Coming soon */}
                  <div className="p-4 rounded-xl border border-border bg-muted">
                    <p className="text-muted-foreground text-xs uppercase tracking-widest mb-2">Coming soon</p>
                    <div className="flex flex-wrap gap-2">
                      {["WhatsApp Integration", "SMS Service", "CRM Sync", "Zapier", "Salesforce"].map(item => (
                        <span key={item} className="px-2.5 py-1 rounded-full bg-muted text-xs text-muted-foreground border border-border">{item}</span>
                      ))}
                    </div>
                  </div>

                  {/* Summary card */}
                  <div className="p-5 rounded-xl border border-border bg-muted mt-2">
                    <p className="text-muted-foreground text-xs uppercase tracking-widest mb-3">Your agent summary</p>
                    <div className="space-y-2">
                      {[
                        { k: "Name",      v: state.agentName || "—" },
                        { k: "Company",   v: state.companyName || "—" },
                        { k: "Use case",  v: USE_CASES.find(u => u.id === state.useCase)?.label || "—" },
                        { k: "Language",  v: [LANGUAGES.find(l => l.code === state.primaryLanguage)?.label, ...state.additionalLanguages.map(c => LANGUAGES.find(l => l.code === c)?.label)].filter(Boolean).join(", ") },
                        { k: "Voice",     v: state.voices.find(v => v.id === state.selectedVoiceId)?.name || "Arushi" },
                        { k: "Direction", v: state.agentDirection },
                      ].map(row => (
                        <div key={row.k} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{row.k}</span>
                          <span className="text-muted-foreground font-medium capitalize">{row.v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ════════════════════════════════════════════
                BYOP FLOW
            ════════════════════════════════════════════ */}
            {state.mode === "byop" && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-[0.2em] mb-3">BYOP Configuration</p>
                <h2 className="text-3xl font-bold text-foreground mb-2">Configure your<br />provider stack</h2>
                <p className="text-muted-foreground text-sm mb-8">Choose your own providers and write a system prompt.</p>

                <div className="space-y-5">
                  <div>
                    <label className="text-muted-foreground text-xs uppercase tracking-widest block mb-2">Agent Name</label>
                    <input type="text" placeholder="My Assistant" value={state.agentName} onChange={e => update({ agentName: e.target.value })}
                      className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-all" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Transcriber (ASR)", key: "byopAsr",       opts: ASR_PROVIDERS },
                      { label: "Language Model",    key: "byopLlm",       opts: LLM_PROVIDERS },
                      { label: "Voice (TTS)",       key: "byopTts",       opts: TTS_PROVIDERS },
                      { label: "Telephony",         key: "byopTelephony", opts: TELEPHONY_PROVIDERS },
                    ].map(field => (
                      <div key={field.key} className="bg-muted border border-border rounded-xl p-3.5">
                        <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-widest mb-2">{field.label}</p>
                        <select
                          value={(state as any)[field.key]}
                          onChange={e => update({ [field.key]: e.target.value } as any)}
                          className="w-full bg-muted border border-border rounded-lg text-xs text-muted-foreground py-2 px-2.5 focus:outline-none focus:border-foreground"
                        >
                          {field.opts.map(o => <option key={`${field.key}-${o.value}`} value={o.value} className="bg-card">{o.label}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="text-muted-foreground text-xs uppercase tracking-widest block mb-2">System Prompt</label>
                    <textarea
                      value={state.byopPrompt} onChange={e => update({ byopPrompt: e.target.value })} rows={6}
                      className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground text-sm focus:outline-none focus:border-foreground transition-all resize-none"
                    />
                  </div>
                </div>
              </div>
            )}

          </SlideStep>
          )}

        </div>
      </div>

      {/* Bottom navigation */}
      {(state.mode !== null || microActive) && (
        <div className="px-8 py-5 border-t border-border shrink-0 flex items-center justify-between">
          <div className="flex gap-1.5">
            {microActive
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-1 rounded-full transition-all duration-300",
                      i < microStep ? "w-5 bg-muted"
                      : i === microStep ? "w-5 bg-zinc-400"
                      : "w-2 bg-muted",
                    )}
                  />
                ))
              : state.mode === "managed" && MANAGED_STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-1 rounded-full transition-all duration-300",
                      i < stepIdx ? "w-5 bg-muted"
                      : i === stepIdx ? "w-5 bg-zinc-400"
                      : "w-2 bg-muted",
                    )}
                  />
                ))}
          </div>

          <div className="flex items-center gap-3">

            {/* ── Micro-wizard navigation ── */}
            {microActive && microStep === 5 && !flowEditMode && (() => {
              const hasFlow = confirmedFlowNodes !== null && confirmedFlowNodes.length > 0;
              const inError = !flowFetching && flowFallback !== null;
              const continueDisabled = flowFetching || inError || !hasFlow;
              return (
                <>
                  {/* Edit this flow button — hidden in error states (nothing to edit) */}
                  {!inError && (
                    <button
                      onClick={() => {
                        setFlowEditText(nodesToText(currentFlowNodes));
                        setFlowEditMode(true);
                      }}
                      disabled={flowFetching || !hasFlow}
                      className={cn(
                        "flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm border transition-all",
                        (flowFetching || !hasFlow)
                          ? "border-border bg-muted text-muted-foreground/60 cursor-not-allowed"
                          : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground",
                      )}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit this flow
                    </button>
                  )}
                  {/* Looks good, continue button — hidden in error states */}
                  {!inError && (
                    <button
                      onClick={handleMicroConfirm}
                      disabled={continueDisabled}
                      className={cn(
                        "flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all",
                        continueDisabled
                          ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                          : "bg-gradient-to-r from-zinc-600 to-zinc-600 hover:from-zinc-500 hover:to-zinc-500 text-white shadow-lg shadow-zinc-500/25",
                      )}
                    >
                      {flowFetching
                        ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
                        : <>Looks good, continue <ChevronRight className="h-4 w-4" /></>}
                    </button>
                  )}
                </>
              );
            })()}

            {/* Edit mode: Apply changes button */}
            {microActive && microStep === 5 && flowEditMode && (
              <button
                onClick={() => {
                  const parsed = textToNodes(flowEditText);
                  if (parsed.length > 0) setConfirmedFlowNodes(parsed);
                  setFlowEditMode(false);
                }}
                className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm bg-gradient-to-r from-zinc-600 to-zinc-600 hover:from-zinc-500 hover:to-zinc-500 text-white shadow-lg shadow-zinc-500/25 transition-all"
              >
                <Check className="h-4 w-4" /> Apply changes
              </button>
            )}

            {/* Questions 0–4: Continue */}
            {microActive && microStep < 5 && (
              <button
                onClick={() => microGo(1)}
                disabled={!microStepValid()}
                className={cn(
                  "flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all",
                  !microStepValid()
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-muted hover:bg-muted text-foreground border border-border",
                )}
              >
                Continue <ChevronRight className="h-4 w-4" />
              </button>
            )}

            {/* ── Normal wizard navigation ── */}
            {!microActive && state.mode === "managed" && currentStep === "knowledge" && (
              <button
                onClick={() => go(1)}
                className="text-muted-foreground hover:text-muted-foreground text-sm flex items-center gap-1.5 transition-colors"
              >
                <SkipForward className="h-3.5 w-3.5" /> Skip for now
              </button>
            )}

            {!microActive && (state.mode === "byop" || currentStep === "skills") ? (
              <button
                onClick={handleCreate}
                disabled={create.isPending}
                className={cn(
                  "flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all",
                  create.isPending
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-gradient-to-r from-zinc-600 to-zinc-600 hover:from-zinc-500 hover:to-zinc-500 text-white shadow-lg shadow-zinc-500/25",
                )}
              >
                {create.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</>
                  : <><Check className="h-4 w-4" /> Create Agent</>
                }
              </button>
            ) : !microActive && currentStep === "requirements" ? (
              null /* requirements step handles its own navigation buttons */
            ) : !microActive ? (
              <button
                onClick={() => {
                  if (currentStep === "details") {
                    const errs: { agentName?: string; companyName?: string } = {};
                    if (!state.agentName.trim()) errs.agentName = "Agent name is required";
                    if (!state.companyName.trim()) errs.companyName = "Company name is required";
                    if (Object.keys(errs).length > 0) { setDetailsErrors(errs); return; }
                    setDetailsErrors({});
                  }
                  /* After language: trigger domain micro-wizard for all use cases */
                  if (currentStep === "language") {
                    setMicroActive(true);
                    setMicroStep(0);
                    setMicroDir("forward");
                    setMicroRenderKey(k => k + 1);
                    setConfirmedFlowNodes(null);
                    setFlowEditMode(false);
                    setFlowEditText("");
                    return;
                  }
                  go(1);
                }}
                disabled={
                  (currentStep === "use-case" && !state.useCase) ||
                  (currentStep === "details" && (!state.agentName.trim() || !state.companyName.trim()))
                }
                className={cn(
                  "flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all",
                  (currentStep === "use-case" && !state.useCase) ||
                  (currentStep === "details" && (!state.agentName.trim() || !state.companyName.trim()))
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-muted hover:bg-muted text-foreground border border-border",
                )}
              >
                Continue <ChevronRight className="h-4 w-4" />
              </button>
            ) : null}

          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
