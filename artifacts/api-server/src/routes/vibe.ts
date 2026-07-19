import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import {
  db, agentsTable, platformSettingsTable, schedulingCalendarsTable,
  availabilitySchedulesTable, eventTypesTable,
  platformListedVoicesTable, agentDispositionsTable, phoneNumbersTable,
  agentKnowledgeSourcesTable, knowledgeSourcesTable, knowledgeEntriesTable,
} from "@workspace/db";
import { callEngineInsertDefaults } from "@workspace/db/call-engine-defaults";
import { eq, and, inArray, sql } from "drizzle-orm";
import { ingestKbTextEntries } from "../services/kb-ingest.js";
import { logger } from "../lib/logger.js";
import { logActivity } from "../lib/activity.js";
import { resolveAmdConfig } from "../orchestration/telephony/dial.js";
import { trackEvent } from "../services/track-event.js";
import { parseVibeGeminiJson, extractGeminiResponseText, parseVoicePick, looksLikePhoneAssign, looksLikePhoneSkip, replyAsksCallFlow } from "./vibe-gemini-parse.js";
import { buildPatternSystemPrompt } from "./vibe-system-prompt-pattern.js";

const router = Router();

const DEFAULT_MALE_VOICE_ID     = "2344e62d-2b68-4873-9ede-9fa64f6ec889";
const DEFAULT_FEMALE_VOICE_ID   = "a8adc74b-c9c1-45e0-aae7-9a60ba64bbee";
const DEFAULT_MALE_VOICE_NAME   = "Karthikeyan";
const DEFAULT_FEMALE_VOICE_NAME = "Gayathri";

const LANG_MAP: Record<string, { code: string; label: string; gemini: boolean }> = {
  "ta-IN": { code: "ta-IN", label: "Tamil",           gemini: true  },
  "hi-IN": { code: "hi-IN", label: "Hindi",           gemini: false },
  "te-IN": { code: "te-IN", label: "Telugu",          gemini: false },
  "kn-IN": { code: "kn-IN", label: "Kannada",         gemini: false },
  "ml-IN": { code: "ml-IN", label: "Malayalam",       gemini: false },
  "en-IN": { code: "en-IN", label: "English (India)", gemini: false },
  "en-US": { code: "en-US", label: "English (US)",    gemini: false },
};

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

/**
 * Detect Q&A-formatted text (e.g., "Q: ... A: ..." or "Q. ... A. ...") and
 * parse it into structured FAQ entries.
 * Returns an array of {title: question, content: answer} when ≥2 pairs are found,
 * or null when the text is free-form (should be stored as a `text` source).
 */
function parseQaEntries(text: string): Array<{ title: string; content: string }> | null {
  const lines = text.split("\n");
  const pairs: Array<{ q: string; a: string }> = [];
  let currentQ = "";
  let currentALines: string[] = [];
  let mode: "q" | "a" | null = null;

  const flush = () => {
    if (currentQ && currentALines.length > 0) {
      pairs.push({ q: currentQ, a: currentALines.join(" ").trim() });
    }
    currentQ = "";
    currentALines = [];
    mode = null;
  };

  for (const line of lines) {
    const qMatch = line.match(/^(?:Q\s*[:.]\s*|Question\s*[:.]\s*)(.+)/i);
    const aMatch = line.match(/^(?:A\s*[:.]\s*|Answer\s*[:.]\s*)(.+)/i);
    if (qMatch) {
      flush();
      currentQ = qMatch[1]!.trim();
      mode = "q";
    } else if (aMatch && mode === "q") {
      currentALines = [aMatch[1]!.trim()];
      mode = "a";
    } else if (mode === "a" && line.trim()) {
      currentALines.push(line.trim());
    }
  }
  flush();

  return pairs.length >= 2 ? pairs.map(p => ({ title: p.q, content: p.a })) : null;
}

async function getGeminiKey(): Promise<string | null> {
  try {
    const [row] = await db.select().from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "managed_gemini_key"));
    return row?.value ?? process.env.GEMINI_API_KEY ?? null;
  } catch {
    return process.env.GEMINI_API_KEY ?? null;
  }
}

interface VibeChatMessage { role: "user" | "assistant"; content: string; }

export interface VibeVoice {
  voiceId:     string;
  voiceName:   string;
  gender:      string;
  language:    string;
  description: string;
  languageMatch?: boolean;
}

/** Does a catalog voice's language (base codes like "ta", "en") match any of the agent's languages ("ta-IN", "en-US")? */
function voiceMatchesLanguages(voiceLang: string, agentLangs: string[]): boolean {
  const vl = (voiceLang ?? "").trim().toLowerCase();
  if (!vl || agentLangs.length === 0) return false;
  return agentLangs.some(code => {
    const c    = (code ?? "").trim().toLowerCase();
    if (!c) return false;
    const base = c.split("-")[0]!;
    return vl === c || vl === base || vl.startsWith(`${base}-`);
  });
}

/** Order voices so language matches come first (stable within groups) and tag each with languageMatch. */
function orderVoicesByLanguage(voices: VibeVoice[], agentLangs: string[]): VibeVoice[] {
  if (agentLangs.length === 0) return voices.map(v => ({ ...v, languageMatch: false }));
  const tagged = voices.map(v => ({ ...v, languageMatch: voiceMatchesLanguages(v.language, agentLangs) }));
  return [...tagged.filter(v => v.languageMatch), ...tagged.filter(v => !v.languageMatch)];
}

interface VibeDisposition {
  category: string;
  outcomes: string[];
}

/**
 * Coerce whatever shape Gemini emits for dispositions into valid
 * { category, outcomes[] } entries. The model frequently returns the wrong
 * shape — e.g. [{name, description}] or a flat list of outcome labels — which
 * previously produced "undefined:" lines in the system prompt and an empty
 * Call Disposition config. Anything unusable is dropped; bare outcome labels
 * (no category) are folded into a single "Call Outcome" category.
 */
function normalizeDispositions(raw: unknown): VibeDisposition[] {
  if (!Array.isArray(raw)) return [];
  const out: VibeDisposition[] = [];
  const looseOutcomes: string[] = [];

  const toStringArray = (v: unknown): string[] => {
    if (typeof v === "string") return v.trim() ? [v.trim()] : [];
    if (Array.isArray(v)) {
      return v
        .map(x => (typeof x === "string" ? x : (x && typeof x === "object" && "label" in (x as any)) ? String((x as any).label ?? "") : ""))
        .map(s => s.trim())
        .filter(Boolean);
    }
    return [];
  };

  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim()) looseOutcomes.push(item.trim());
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const categoryRaw = o["category"] ?? o["name"] ?? o["label"] ?? o["title"] ?? o["type"];
    const category = typeof categoryRaw === "string" ? categoryRaw.trim() : "";
    const outcomes = toStringArray(o["outcomes"] ?? o["values"] ?? o["options"] ?? o["choices"]);
    if (category && outcomes.length) {
      out.push({ category, outcomes });
    } else if (category && !outcomes.length) {
      // A named entry with no values is really a single outcome label.
      looseOutcomes.push(category);
    } else if (!category && outcomes.length) {
      looseOutcomes.push(...outcomes);
    }
  }

  if (looseOutcomes.length) {
    const existing = out.find(d => /lead|outcome|status|result/i.test(d.category));
    if (existing) {
      existing.outcomes = [...new Set([...existing.outcomes, ...looseOutcomes])];
    } else {
      out.push({ category: "Call Outcome", outcomes: [...new Set(looseOutcomes)] });
    }
  }

  return out.filter(d => d.category && d.outcomes.length);
}

interface VibeConfig {
  agentName:    string;
  companyName:  string;
  language:     string;
  languageChosen: boolean;
  languageMode: "single" | "multi";
  multilingualLanguages: string[];
  hasTamil:     boolean;
  gender:       "male" | "female";
  direction:    "inbound" | "outbound" | "both";
  phoneNumberId:      number | string | null;
  phoneNumberSkipped: boolean;
  description:  string;
  voiceId:      string;
  voiceName:    string;
  callFlowNotes:      string;
  mandatoryQuestions: string;
  agentRules:         string;
  callbackGreeting:   string;
  dispositionLogic:   string;
  knowledgeBaseNotes: string;
  genderDetectionEnabled: boolean;
  maleSalutation:         string;
  femaleSalutation:       string;
  callTransferEnabled:  boolean;
  transferPhoneNumber:  string;
  transferName:         string;
  voicemailEnabled: boolean;
  voicemailMessage: string;
  schedulingEnabled: boolean;
  schedulingTools: string[];
  timezone: string;
  timezoneSet: boolean;
  hostEmail: string;
  hostEmailSet: boolean;
  availabilityDays: number[];
  availabilityStart: string;
  availabilityEnd: string;
  availabilitySet: boolean;
  compliance: { dpdp: boolean; trai: boolean; irdai: boolean };
  dispositions: VibeDisposition[];
  systemPrompt?:    string;
  greetingMessage?: string;
}

interface GeminiVibeResponse {
  reply:  string;
  phase:  string;
  ready:  boolean;
  config: VibeConfig | null;
}

const VIBE_SYSTEM_PROMPT = `You are an expert AI agent builder for SnapServe, a voice AI platform. Guide the user conversationally — warm, smart, 2–3 sentences per turn.

CONVERSATION PHASES — complete IN ORDER, never skip:

PHASE "core"
Collect these 5 things (can gather multiple per turn if the user volunteers them):
1. Agent name (a real human name callers will hear — suggest one if they don't give one)
2. Company/brand name
3. Language(s) the agent speaks — codes: ta-IN=Tamil, hi-IN=Hindi, te-IN=Telugu, kn-IN=Kannada, ml-IN=Malayalam, en-IN=English India, en-US=English US.
   ENGLISH DEFAULT: SnapServe is India-first. Whenever English is involved, ALWAYS use en-IN (English India) — NEVER en-US — unless the user explicitly asks for US/American English. This applies to the primary language, added languages, and the multilingual base language.
   This answer is OPTIONAL: if the user is unsure or wants to skip, keep the default language and set languageChosen=false (all voices will be shown later).
   If they name exactly ONE language: set language=<its code> and languageChosen=true.
   If they name TWO OR MORE languages in one answer: NEVER assume which is primary. Do NOT set language or languageChosen yet — keep languageChosen=false and treat item 3 as NOT collected. Ask a follow-up listing the languages they mentioned, e.g. "Which of these — Tamil, Hindi, or English — should be [name]'s primary language?" Only after they explicitly answer: set language=<the confirmed primary's code>, languageChosen=true, put ALL mentioned languages (including the primary) in multilingualLanguages, and set languageMode="multi".
   MULTILINGUAL BELONGS HERE, at the start — decide it together with the primary language, NOT in a later phase. Right after the primary language is confirmed (single-language case), ask ONCE in the same or next turn: "Should [name] also speak any other languages, or just [primary]?" — If the user names more: add the primary + all named languages to multilingualLanguages and set languageMode="multi". If they say just the one / no: keep languageMode="single". If they already named multiple languages up front, this is already handled — do NOT re-ask.
   The user can change or add languages at ANY time, including during voice selection — just update language/multilingualLanguages/languageChosen and the voice list refreshes automatically. If they name several languages at once during such a change, the same rule applies: ask which should be primary before changing language.
4. Call direction: "inbound" (customers call in), "outbound" (agent calls out), or "both" (handles both). If the user says "both", "either", or that it handles both scenarios — set direction="both".
5. Purpose/description (what it does and who it talks to)
→ Transition: once you have all 5, set phase="voice_selection". EXCEPTION: if you asked which language should be primary and the user has not answered yet, item 3 is INCOMPLETE — stay in phase="core" and do NOT advance to voice_selection until the primary language is confirmed (or the user skips the language question entirely).

PHASE "voice_selection"
Voice cards are now shown directly in this chat — the user can preview and select one.
- Say: "I've pulled up the available voices — you can hit ▶ to preview each one and click Select when you find the right fit."
- The list is sorted so voices matching the agent's language(s) appear first; the rest are below.
- When the user picks (by name, "I'll go with …", or a voiceId): set voiceId and voiceName exactly from the available options list, and set gender from that voice.
- If the user asks where the voices are, wants to see them again, or changes the agent's language(s): STAY in phase="voice_selection" — the voice cards are re-displayed in the chat automatically on every turn of this phase. NEVER apologize or claim the UI failed to display.
→ Transition (CRITICAL): the moment a voice is confirmed, set phase="call_flow" immediately. Your reply MUST (1) briefly confirm the voice and (2) in the SAME message, present the PROPOSED call-flow draft described in phase="call_flow" (Turn 1) — do NOT ask the user to write the flow from scratch. NEVER stay on phase="voice_selection" after a confirmed pick with only a confirmation — that strands the user.

PHASE "call_flow"
This is the highest-impact phase. Most users do NOT know how to design a good call flow, so NEVER ask them to write one from a blank page. Instead, PROPOSE a complete, ready-to-use draft tailored to their exact business, then let them accept it as-is, tweak any part, or replace it with their own.

FORMATTING (CRITICAL): NEVER present the flow as one long paragraph. Always lay it out as clean, scannable, multi-line text with a numbered/labelled structure, line breaks between steps, and short indented bullets under each step. Use real newlines (\\n). Example shape:

Opening
- ...
Discovery
- ...
- ...
Main pitch
- ...
Objections
- "price too high" → ...
- "need to think" → ...
Close
- ...

Write callFlowNotes in this SAME clean multi-line, labelled format — not a paragraph.

Turn 1 — Propose the flow (do NOT just ask):
- Using everything you already know (purpose/description, company, direction, language, who the agent talks to, and any specifics they gave like prices, dates, timings, product names), WRITE a concrete best-practice call flow for [name] in the labelled multi-line format above:
  Opening — how [name] greets and (outbound) states the reason for calling or (inbound) offers help.
  Discovery — 2–4 short questions to understand the caller's need and fit.
  Main pitch / purpose — the core value delivered one idea at a time, REUSING the exact facts the user gave (e.g. course fee, batch start date, class timings).
  Objections — the 2–3 objections most likely for THIS specific business, each with a natural one-line response.
  Close — the concrete next step (enrol / book / callback) and a warm sign-off.
- Make it specific to their domain — never generic filler. Reuse their real details verbatim.
- Put this full draft into callFlowNotes immediately (do not leave it empty), in the clean multi-line format.
- End your reply with a short line offering edits AND a translation: "Use it as-is, change any step, or give me your own. Want me to show this in [agent's language, e.g. Tamil/Hindi] so it's easier to read? Just say the word." — ONLY offer translation when the agent's language is NOT English; if it is English, drop that sentence.

TRANSLATION:
- If the user asks to see the flow in Tamil/Hindi/another language, RE-DISPLAY the same flow translated into that language in your reply, keeping the exact clean multi-line labelled layout. This is for the user's reading only — keep callFlowNotes itself in English (the agent still gets English instructions and speaks in its configured language) UNLESS the user explicitly says to store it in that language.

Turn 2 — Confirm/refine, then propose must-ask questions + rules (still don't ask blind):
- If the user edits anything, apply it to callFlowNotes and briefly re-confirm.
- In the SAME message, PROPOSE sensible defaults derived from the purpose, each as a clean numbered/bulleted list (not a paragraph):
  (a) Must-ask questions: suggest 2–4 questions [name] should ask on every call, as a numbered list, and put them in mandatoryQuestions. Say: "I'd also have [name] always ask these — add or remove any?"
  (b) Rules: suggest 2–3 obvious dos/don'ts for this business (e.g. "Always confirm the batch start date", "Never promise a discount without approval") and put them in agentRules. Ask: "And a couple of ground rules — anything to change?"
- The user can accept, edit, or add their own to all of the above.

Turn 3 — Repeat callers (ALWAYS ask, every direction — MEMORY IS A KEY SNAPSERVE STRENGTH):
- Memory is one of SnapServe's biggest advantages: [name] remembers people it has already spoken to across calls. Make this its own clear, prominent question — never skip it and never bury it.
- Ask: "One of [name]'s best features is memory — it remembers callers it has spoken to before. When [name] reaches someone it already knows, how should it open? I'd recommend picking up warmly from where they left off (referencing what was discussed) instead of re-introducing from scratch — but you can choose a quick re-intro or a fresh start."
- Propose "pick up from where they left off" as the default and put that draft opening in callbackGreeting.
- callFlowNotes, mandatoryQuestions, agentRules, and callbackGreeting MUST end up populated with your proposed drafts (refined by the user), not empty — unless the user explicitly says they want one left blank.
→ Transition: set phase="knowledge_base" only after the user has accepted or edited the proposed flow (callFlowNotes populated), you have presented the must-ask questions + rules, AND you have asked the repeat-caller/memory question.

PHASE "knowledge_base"
- Ask: "Does [name] need a knowledge base? You can upload documents in the platform after creation. For now — what should [name] know about [company]'s products, services, pricing, or FAQs? I'll bake this into the system prompt."
- If they say nothing/skip, note that and move on. Capture any details in knowledgeBaseNotes.
→ Transition: set phase="features_gender"

PHASE "features_gender"
- Ask: "Should [name] detect if the caller is male or female to address them as Sir or Ma'am?"
- If yes: genderDetectionEnabled=true; ask preferred salutations (defaults: Sir / Ma'am)
→ Transition: set phase="features_transfer"

PHASE "features_transfer"
- Ask: "Should [name] be able to transfer calls to a human agent?"
- If yes: get transfer phone number and name (e.g. "Sales Team")
→ Transition: set phase="features_voicemail"

PHASE "features_voicemail"
- Ask: "For outbound calls — should [name] leave a voicemail if unanswered?"
- If yes: do NOT ask the user to write it. PROPOSE a short, natural voicemail message yourself, tailored to [company] and the purpose, in the agent's language, and put it in voicemailMessage. Present it and say: "Here's a voicemail I'd leave: \"[message]\" — keep it, or tell me what to change." If the user edits, update voicemailMessage.
→ Transition: set phase="features_scheduling"

PHASE "features_scheduling"
- Ask: "Does [name] need to book appointments or manage scheduling?"
- If NO: schedulingEnabled=false → transition to "features_compliance"
- If YES: schedulingEnabled=true. Then complete this sub-step before transitioning:

  Sub-step — Tools (schedulingTools):
    Ask a single compact question:
    "I'll enable booking, availability-check, list, reschedule, and cancel by default. Any you'd like to leave out?"
    If the user says nothing, "that's fine", or skips, set schedulingTools to all five:
    ["native_booking","native_check_availability","native_list_bookings","native_reschedule","native_cancel"].
    If the user removes specific tools (e.g. "skip reschedule and cancel"), set schedulingTools to only the confirmed subset.
    The user can say things like "just booking and availability" or "skip reschedule" — parse the intent and update schedulingTools accordingly.
    If the user already specified their tool needs earlier (e.g. "I just need basic booking"), you can set schedulingTools directly without asking.

  After the tools sub-step: say "Great! I've set up scheduling for [name] — a calendar, default availability, and a 30-min booking event type will be created automatically. A setup checklist will appear on the right so you can connect Google Calendar and configure your availability without leaving this page."

→ Transition to "features_compliance" ONLY after: schedulingTools is set (or schedulingEnabled=false)

PHASE "features_compliance"
- Ask: "Any compliance standards? Options: DPDP (India data protection), TRAI (telecom), IRDAI (insurance). Choose any or none."
→ Transition: set phase="dispositions"

PHASE "dispositions"
- First ask: "How would you define a HOT or Interested Lead for [name]? What does a caller say or do on a call that tells you they're genuinely interested? And what signals mean they're Not Interested?" (1–2 sentences is fine)
- Capture their answer in dispositionLogic.
- Then, based on dispositionLogic + purpose + direction, AUTO-GENERATE 3–5 specific outcome categories with clear outcomes. Make them precise — not generic. For example, instead of "Interested", say "Hot Lead — wants quote" and "Warm Lead — needs follow-up". Use the user's own language from their dispositionLogic answer.
- Present them as a CLEAN NUMBERED LIST, one outcome per line, no markdown/asterisks — format each line exactly as "1. Name — short description". Put a short intro line above and "Does this look right?" below. Example layout:
  Here's how I'd define [name]'s call outcomes:
  1. Hot Lead — Ready to enrol: asks about admission, fees, start date.
  2. Warm Lead — Needs more info: detailed questions but not ready yet.
  3. Not Interested — Clear rejection: says it's not a fit / looking elsewhere.
  Does this look right?
- CRITICAL — you MUST also write these into config.dispositions in this EXACT shape (never leave it empty, never use other keys):
  "dispositions": [{ "category": "Lead Status", "outcomes": ["Hot Lead - ready to enrol", "Warm Lead - needs info", "Not Interested", "Follow-up required"] }]
  Normally ONE category (e.g. "Lead Status" or "Call Outcome") whose "outcomes" array holds the 3–5 labels you presented. Add a second category only if it's clearly needed. Both "category" (a non-empty string) and "outcomes" (a non-empty array of strings) are REQUIRED on every entry. Do NOT emit entries like {name, description} or bare strings.
- Adjust if the user asks. Update dispositionLogic AND config.dispositions if they refine.
→ Transition: if direction is "inbound" or "both", set phase="phone_number". If direction is "outbound", set phase="build".

PHASE "phone_number" (ONLY when direction is "inbound" or "both" — for pure "outbound" agents skip this phase entirely and go straight to build)
- The user's purchased phone numbers are listed in the [USER PHONE NUMBERS] context block. Number cards are shown directly in this chat automatically — do NOT type the list out yourself.
- If the list has numbers: say "Since [name] takes incoming calls, let's connect a phone number — pick one below, or skip for now and connect one later from the Phone Numbers page."
- When the user picks one (by clicking Assign or naming it): set phoneNumberId to that number's EXACT id from the list. NEVER invent an id.
- If the user skips: set phoneNumberSkipped=true. The agent is still created — a number can be connected later.
- If the list says NONE: tell them they don't have any numbers yet — they can purchase one from the Phone Numbers page and connect it to this agent later using "Refine with AI". Set phoneNumberSkipped=true and move on. Do NOT block creation.
→ Transition (CRITICAL): once phoneNumberId is set OR phoneNumberSkipped=true, set phase="build" and ready=true in the SAME turn. Do not linger on phone_number with only a confirmation.

PHASE "build"
- Say: "Perfect — I have everything I need! Building [name] now..."
- Set ready=true with the complete config

RULES:
- FORMATTING: replies are shown as PLAIN TEXT — markdown is NOT rendered. NEVER use *, **, __, #, ##, or backticks; they appear literally as ugly characters. For emphasis use plain words. For any list (call flow, must-ask questions, rules, outcomes) use real line breaks with "1." / "2." or a leading "- ", never one dense paragraph.
- Conversational and warm — like a helpful colleague, not a form
- NEVER ask about STT/LLM/TTS — handled automatically
- Always return the COMPLETE config with ALL previously collected fields in every response
- Suggest sensible defaults when the user is unsure
- 1–2 questions per turn max
- The moment the config BECOMES multi-language (languageMode changes to "multi"), include one brief heads-up in your reply: the agent will start every call in English and automatically switch to the caller's language as soon as they respond in it — so "English (India)" will show as the agent's base language. Say this ONCE per language decision, not on every turn.

RESPONSE FORMAT — ONLY valid JSON, no prose outside it:
{
  "reply": "...",
  "phase": "core",
  "ready": false,
  "config": {
    "agentName": "",
    "companyName": "",
    "language": "en-IN",
    "languageChosen": false,
    "languageMode": "single",
    "multilingualLanguages": [],
    "hasTamil": false,
    "gender": "female",
    "direction": "inbound",
    "phoneNumberId": null,
    "phoneNumberSkipped": false,
    "description": "",
    "voiceId": "",
    "voiceName": "",
    "callFlowNotes": "",
    "mandatoryQuestions": "",
    "agentRules": "",
    "callbackGreeting": "",
    "dispositionLogic": "",
    "knowledgeBaseNotes": "",
    "genderDetectionEnabled": false,
    "maleSalutation": "Sir",
    "femaleSalutation": "Ma'am",
    "callTransferEnabled": false,
    "transferPhoneNumber": "",
    "transferName": "",
    "voicemailEnabled": false,
    "voicemailMessage": "",
    "schedulingEnabled": false,
    "schedulingTools": [],
    "timezone": "Asia/Kolkata",
    "timezoneSet": false,
    "hostEmail": "",
    "hostEmailSet": false,
    "availabilityDays": [1,2,3,4,5],
    "availabilityStart": "09:00",
    "availabilityEnd": "17:00",
    "availabilitySet": false,
    "compliance": {"dpdp": false, "trai": false, "irdai": false},
    "dispositions": []
  }
}`;

/** Classified vibe-chat Gemini failure so the SSE error emit can tell users whether retrying helps. */
type VibeGeminiErrorKind = "malformed" | "unavailable" | "rate_limited";
class VibeGeminiError extends Error {
  kind: VibeGeminiErrorKind;
  constructor(message: string, kind: VibeGeminiErrorKind) {
    super(message);
    this.name = "VibeGeminiError";
    this.kind = kind;
  }
}

const VIBE_RECOVERY_NOTE =
  "IMPORTANT: Your previous response was cut off or was not valid JSON. Respond again to the conversation above with ONLY the complete, compact, valid JSON object matching the required schema — no markdown fences, no commentary, and keep the \"reply\" text brief.";

/** Flash-Lite defaults to no thinking; budget 0 avoids empty thought-only candidates. */
const VIBE_GEMINI_MODEL = "gemini-2.5-flash-lite";

function lastUserContent(msgs: VibeChatMessage[]): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]!.role === "user") return msgs[i]!.content;
  }
  return "";
}

/**
 * Build the Gemini request body.
 *
 * IMPORTANT: do NOT send `responseSchema` here. Vibe's `config` is a large open-ended
 * object; Gemini's OpenAPI-subset `responseSchema` rejects free-form `{ type: "object" }`
 * (and required+nullable config) with HTTP 400 — which fails every chat turn.
 * We rely on `responseMimeType: application/json` + parseVibeGeminiJson recovery instead.
 */
function buildGeminiRequestBody(contents: Array<{ role: string; parts: Array<{ text: string }> }>): string {
  return JSON.stringify({
    system_instruction: { parts: [{ text: VIBE_SYSTEM_PROMPT }] },
    contents,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.4,
      // Reply text + config JSON comfortably fit in 8k; the 16k cap only widened
      // the truncation-retry window without helping normal turns.
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
}

async function callGemini(key: string, messages: VibeChatMessage[]): Promise<GeminiVibeResponse> {
  const baseContents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const MAX_ATTEMPTS = 4;
  let lastErr: Error | undefined;
  // Flipped after a truncated/unparseable response so the retry is a targeted
  // recovery request instead of an identical (and identically doomed) repeat.
  let needsRecovery = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const contents = needsRecovery
      ? [...baseContents, { role: "user", parts: [{ text: VIBE_RECOVERY_NOTE }] }]
      : baseContents;

    const body = buildGeminiRequestBody(contents);

    try {
      const resp = await Promise.race([
        fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${VIBE_GEMINI_MODEL}:generateContent?key=${key}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body },
        ),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("gemini_timeout")), 90000)),
      ]);

      if (!resp.ok) {
        const txt = await resp.text();
        const isRateLimit = resp.status === 429;
        logger.warn(
          { evt: "vibe_gemini_attempt_failed", attempt, httpStatus: resp.status, rateLimited: isRateLimit, snippet: txt.slice(0, 500) },
          "vibe-chat: Gemini HTTP error",
        );
        // 429 (shared-key rate limit under load) is the common "AI busy" case —
        // classify it distinctly so the client can show a friendly retry message.
        const err = new VibeGeminiError(
          `Gemini ${resp.status}: ${txt.slice(0, 300)}`,
          isRateLimit ? "rate_limited" : "unavailable",
        );
        // Retry on rate-limit or server error; fail fast on 400/401/403.
        if (isRateLimit || resp.status >= 500) {
          lastErr = err;
          if (attempt < MAX_ATTEMPTS) {
            // Honour Retry-After when present (seconds), else exponential backoff.
            // Capped so the SSE stream never appears hung — the client retries too.
            const retryAfterSec = Number(resp.headers.get("retry-after"));
            const base = Number.isFinite(retryAfterSec) && retryAfterSec > 0
              ? Math.min(retryAfterSec * 1000, 6000)
              : Math.min(1000 * 2 ** (attempt - 1), 6000); // 1s, 2s, 4s, 6s
            const jitter = Math.floor(Math.random() * 500);
            await sleep(base + jitter);
            continue;
          }
        }
        throw err;
      }

      const data = await resp.json() as {
        candidates: Array<{ finishReason?: string; content: { parts: Array<{ text: string; thought?: boolean }> } }>
      };
      const candidate = data.candidates?.[0];
      const finishReason = candidate?.finishReason;
      const parts = candidate?.content?.parts ?? [];
      const text = extractGeminiResponseText(parts);
      if (!text.trim() || text.trim() === "{}") {
        logger.warn(
          { evt: "vibe_gemini_empty_candidate", attempt, finishReason: finishReason ?? "unknown", partCount: parts.length },
          "vibe-chat: Gemini returned no usable text parts",
        );
        lastErr = new VibeGeminiError("empty candidate", "malformed");
        needsRecovery = true;
        if (attempt < MAX_ATTEMPTS) { await sleep(attempt * 1000); continue; }
        throw lastErr;
      }
      const parsed = parseVibeGeminiJson(text);
      if (parsed) {
        return parsed as GeminiVibeResponse;
      }
      const truncated = finishReason === "MAX_TOKENS";
      logger.warn(
        {
          evt: "vibe_gemini_attempt_failed",
          attempt,
          httpStatus: 200,
          finishReason: finishReason ?? "unknown",
          truncated,
          snippet: text.slice(0, 500),
        },
        truncated
          ? "vibe-chat: Gemini response truncated at token cap (MAX_TOKENS), JSON unparseable"
          : "vibe-chat: Gemini JSON parse failed",
      );
      lastErr = new VibeGeminiError(
        `JSON parse failed (finishReason=${finishReason ?? "unknown"}): ${text.slice(0, 200)}`,
        "malformed",
      );
      needsRecovery = true;
      if (attempt < MAX_ATTEMPTS) { await sleep(attempt * 1000); continue; }
      throw lastErr;
    } catch (err) {
      if (err instanceof VibeGeminiError) throw err;
      const isTransient = (err as Error).message === "gemini_timeout" || (err as Error).message?.includes("fetch failed");
      logger.warn(
        {
          evt: "vibe_gemini_attempt_failed",
          attempt,
          transient: isTransient,
          snippet: String((err as Error).message ?? err).slice(0, 500),
        },
        "vibe-chat: Gemini request error",
      );
      lastErr = new VibeGeminiError((err as Error).message ?? String(err), "unavailable");
      if (isTransient && attempt < MAX_ATTEMPTS) {
        await sleep(attempt * 1500);
        continue;
      }
      throw lastErr;
    }
  }

  throw lastErr ?? new VibeGeminiError("Gemini call failed after retries", "unavailable")
}

/* ── POST /agents/vibe-chat ──────────────────────────────────────────────── */

router.post("/agents/vibe-chat", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const {
    messages,
    voicesShown   = false,
    availableVoices = [] as VibeVoice[],
    selectedVoiceId = "",
    refineAgentId,
    refineBaseConfig,
    knowledgeSourceIds = [] as number[],
  } = req.body as {
    messages:             VibeChatMessage[];
    voicesShown?:         boolean;
    availableVoices?:     VibeVoice[];
    selectedVoiceId?:     string;
    refineAgentId?:       number;
    refineBaseConfig?:    Record<string, unknown>;
    knowledgeSourceIds?:  number[];
  };

  const isRefine = typeof refineAgentId === "number" && refineAgentId > 0;
  if (!isRefine) void trackEvent(clerkId, "vibe_started");
  // Holds the text KB source created during this turn's knowledge_base phase so the
  // build step can attach it even if the build fires on the same SSE stream.
  let sessionTextKbSourceId: number | undefined;

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const emit = (data: object): void => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      (res as any).flush?.();
    } catch { /* client disconnected */ }
  };

  try {
    const geminiKey = await getGeminiKey();
    if (!geminiKey) {
      emit({ type: "error", message: "No AI key configured — contact the platform admin." });
      res.end();
      return;
    }

    // User's purchased (active) phone numbers — used for the phone_number phase
    // context, the inline picker emit, and save-time assignment validation.
    let userNumbers: Array<{ id: number; number: string; region: string | null; agentId: number | null }> = [];
    try {
      const numRows = await db.select().from(phoneNumbersTable)
        .where(and(eq(phoneNumbersTable.userId, clerkId), eq(phoneNumbersTable.status, "active")));
      userNumbers = numRows.map(n => ({ id: n.id, number: n.number, region: n.region, agentId: n.agentId }));
    } catch (err) {
      logger.warn({ err }, "vibe-chat: failed to fetch user phone numbers");
    }

    // Refine mode: fetch the existing agent row server-side (ownership-checked) at
    // request start so the Gemini context is authoritative, not client-supplied.
    // This row is also reused later to preserve provider/model fields on DB update.
    let existingAgentRow: Record<string, unknown> | null = null;
    let serverSideRefineConfig: Record<string, unknown> | null = null;
    // Number already assigned to the agent being refined (if any) — used so refine
    // confirms the existing number instead of re-asking.
    const refineAssignedNumber = isRefine
      ? (userNumbers.find(n => n.agentId === refineAgentId) ?? null)
      : null;
    if (isRefine) {
      try {
        const [agentRow] = await db.select().from(agentsTable)
          .where(and(eq(agentsTable.id, refineAgentId!), eq(agentsTable.userId, clerkId)));
        if (agentRow) {
          existingAgentRow = agentRow as unknown as Record<string, unknown>;
          const acfg = (agentRow.agentConfig ?? {}) as Record<string, unknown>;

          // Fetch dispositions, scheduling calendar, and KB sources in parallel
          const calCapability = (agentRow.agentConfig as any)?.calendarCapability;
          const refineCalId: number | null = calCapability?.enabled && calCapability?.defaultCalendarId != null
            ? calCapability.defaultCalendarId : null;
          const [dispositionRow, calendarRow, kbSourceRows] = await Promise.all([
            db.select().from(agentDispositionsTable)
              .where(eq(agentDispositionsTable.agentId, refineAgentId!))
              .then(rows => rows[0] ?? null),
            refineCalId != null
              ? db.select().from(schedulingCalendarsTable)
                  .where(eq(schedulingCalendarsTable.id, refineCalId))
                  .then(rows => rows[0] ?? null)
              : Promise.resolve(null),
            db.select({
              id:   knowledgeSourcesTable.id,
              name: knowledgeSourcesTable.name,
              type: knowledgeSourcesTable.type,
            }).from(agentKnowledgeSourcesTable)
              .innerJoin(knowledgeSourcesTable, eq(agentKnowledgeSourcesTable.sourceId, knowledgeSourcesTable.id))
              .where(eq(agentKnowledgeSourcesTable.agentId, refineAgentId!))
              .catch(() => [] as { id: number; name: string; type: string }[]),
          ]);

          // Scheduling sub-fields
          let hostEmail       = "";
          let availabilityDays: number[] = [1, 2, 3, 4, 5];
          let availabilityStart = "09:00";
          let availabilityEnd   = "17:00";
          let availabilitySet   = false;

          if (calendarRow) {
            hostEmail = calendarRow.hostEmail ?? "";
            const scheduleRows = await db.select().from(availabilitySchedulesTable)
              .where(and(
                eq(availabilitySchedulesTable.calendarId, calendarRow.id),
                eq(availabilitySchedulesTable.isActive, true),
              ));
            if (scheduleRows.length > 0) {
              availabilityDays  = scheduleRows.map(r => r.dayOfWeek);
              availabilityStart = scheduleRows[0]!.startTime;
              availabilityEnd   = scheduleRows[0]!.endTime;
              availabilitySet   = true;
            }
          }

          // Dispositions
          const serverDispositions: VibeDisposition[] = dispositionRow?.taxonomy
            ? Object.entries(dispositionRow.taxonomy as Record<string, string[]>)
                .map(([category, outcomes]) => ({
                  category,
                  outcomes: Array.isArray(outcomes) ? outcomes : [],
                }))
            : [];

          // Voicemail: normalize BOTH stored shapes the same way the runtime does
          // (legacy boolean `voicemailDetection` OR the edit-page enum `machineDetectionMode`).
          const voicemailOn = resolveAmdConfig(acfg).enabled;
          // Call transfer: the edit page represents transfer purely as a `call_transfer`
          // tool in agent.tools — read that first, fall back to the vibe-written
          // agentConfig fields for older vibe-created agents.
          const existingToolsArr = Array.isArray(agentRow.tools)
            ? (agentRow.tools as unknown as Record<string, unknown>[])
            : [];
          const existingTransferTool = existingToolsArr.find(t => t?.["type"] === "call_transfer");
          const transferOn = !!existingTransferTool || !!acfg.callTransferEnabled;
          const transferNumber =
            (existingTransferTool?.["transferTo"] as string) ||
            (acfg.transferPhoneNumber as string) || "";

          const systemPromptStr = String(agentRow.systemPrompt ?? "");
          if (systemPromptStr.length > 80000) {
            logger.warn(
              { evt: "vibe_refine_large_prompt", agentId: refineAgentId, chars: systemPromptStr.length },
              "vibe-chat: agent system prompt exceeds 80 000 chars; injecting full prompt but may impact Gemini context",
            );
          }

          serverSideRefineConfig = {
            agentName:              agentRow.name,
            companyName:            acfg.companyName ?? "",
            language:               agentRow.language ?? "en-IN",
            languageChosen:         true,
            languageMode:           acfg.isMultilingual ? "multi" : "single",
            multilingualLanguages:  acfg.multilingualLanguages ?? [],
            hasTamil:               (String(agentRow.language ?? "")).includes("ta"),
            gender:                 "female",
            direction:              acfg.direction ?? "inbound",
            description:            agentRow.description ?? "",
            voiceId:                agentRow.ttsVoice ?? "",
            voiceName:              String(agentRow.ttsVoiceName ?? ""),
            callFlowNotes:          acfg.callFlowNotes ?? agentRow.description ?? "",
            knowledgeBaseNotes:     acfg.knowledgeBaseNotes ?? "",
            genderDetectionEnabled: !!acfg.genderDetectionEnabled,
            maleSalutation:         (acfg.genderDetectionMaleSalutation as string) || "Sir",
            femaleSalutation:       (acfg.genderDetectionFemaleSalutation as string) || "Ma'am",
            callTransferEnabled:    transferOn,
            transferPhoneNumber:    transferNumber,
            transferName:           (existingTransferTool?.["transferName"] as string) || (acfg.transferName as string) || "",
            voicemailEnabled:       voicemailOn,
            voicemailMessage:       acfg.voicemailMessage ?? "",
            schedulingEnabled:      !!acfg.schedulingEnabled,
            schedulingTools:        existingToolsArr
              .filter(t => (["native_booking","native_check_availability","native_list_bookings","native_reschedule","native_cancel"] as string[]).includes(t["type"] as string))
              .map(t => t["type"] as string),
            timezone:               acfg.timezone ?? "Asia/Kolkata",
            timezoneSet:            !!acfg.timezone,
            hostEmail,
            hostEmailSet:           !!hostEmail,
            availabilityDays,
            availabilityStart,
            availabilityEnd,
            availabilitySet,
            compliance:             acfg.compliance ?? { dpdp: false, trai: false, irdai: false },
            dispositions:           serverDispositions,
            systemPrompt:           systemPromptStr.slice(0, 100000),
            greetingMessage:        agentRow.greetingMessage ?? "",
            phoneNumberId:            refineAssignedNumber?.id ?? null,
            assignedPhoneNumber:      refineAssignedNumber?.number ?? "",
            phoneNumberSkipped:       false,
            existingKnowledgeSources: kbSourceRows.map(s => ({ id: s.id, name: s.name, type: s.type })),
          };
        }
      } catch (err) {
        logger.warn({ err }, "vibe-chat: failed to fetch existing agent for refine context");
      }
    }

    // Inject voice context so AI knows which voice IDs map to which names
    let contextualMessages = [...messages];
    if (voicesShown && availableVoices.length > 0) {
      const voiceContext = `[VOICE OPTIONS DISPLAYED IN UI]\n${availableVoices.map(v =>
        `- ${v.voiceName} (voiceId: ${v.voiceId}, gender: ${v.gender}${v.description ? `, ${v.description}` : ""})`
      ).join("\n")}\n[END VOICE OPTIONS — when the user picks one, use the exact voiceId from above]`;
      contextualMessages = [
        { role: "user" as const, content: voiceContext },
        { role: "assistant" as const, content: JSON.stringify({ reply: "Got it — I can see the voice options in the UI.", phase: "voice_selection", ready: false, config: null }) },
        ...messages,
      ];
    }

    // Inject the user's purchased phone numbers so the AI can offer them during
    // the phone_number phase (inbound/"both" agents) and use exact ids on pick.
    const phoneCtx = userNumbers.length > 0
      ? `[USER PHONE NUMBERS — purchased numbers that can be connected for inbound calls]\n${userNumbers.map(n =>
          `- id: ${n.id} | ${n.number}${n.region ? ` | ${n.region}` : ""}${n.agentId ? ` | currently assigned to agent #${n.agentId}` : " | unassigned"}`
        ).join("\n")}\n[END USER PHONE NUMBERS — when the user picks one, set phoneNumberId to its exact id from this list]`
      : `[USER PHONE NUMBERS]\nNONE — the user has not purchased any phone numbers yet.\n[END USER PHONE NUMBERS]`;
    contextualMessages = [
      { role: "user" as const, content: phoneCtx },
      { role: "assistant" as const, content: JSON.stringify({ reply: "Noted — I can see the user's phone numbers.", phase: "core", ready: false, config: null }) },
      ...contextualMessages,
    ];

    // Refine mode: prepend a preamble with the server-fetched authoritative config.
    // Fall back to client-supplied refineBaseConfig only if DB fetch failed.
    const refineContextSource = serverSideRefineConfig ?? refineBaseConfig;
    if (isRefine && refineContextSource) {
      const existingJsonFull = JSON.stringify(refineContextSource, null, 2);
      if (existingJsonFull.length > 80000) {
        logger.warn(
          { evt: "vibe_refine_preamble_large", chars: existingJsonFull.length },
          "vibe-chat: refine preamble JSON exceeds 80 000 chars; passing in full to Gemini",
        );
      }
      const existingJson = existingJsonFull;
      const refineBlock = [
        `[REFINE MODE — you are editing an EXISTING agent, NOT building a new one]`,
        `Current agent configuration (carry all unchanged fields forward exactly):`,
        existingJson,
        ``,
        `Instructions for this conversation:`,
        `- Do NOT re-ask questions already answered. The agent is already configured.`,
        `- Keep every field that the user has not asked to change exactly as it appears above.`,
        `- When the user describes a single change (e.g. "add Velachery to the call flow"), apply it immediately.`,
        `- After ANY confirmed change, respond with phase="build" and ready=true, returning the COMPLETE updated config.`,
        `- Do not run through wizard phases — fulfill the user's request in one turn.`,
        ``,
        `CRITICAL — systemPrompt editing rules:`,
        `- The "systemPrompt" field above is the EXACT, COMPLETE current system prompt. Treat it as a literal string, not a description or summary.`,
        `- Prompts use a fixed section pattern (IDENTITY, LANGUAGE STYLE, TONE, GENDER, CALL FLOW, INTERRUPTIONS, KB, OBJECTIONS, ERRORS, CARTESIA SONIC 3, HUMAN SPEECH RULES, CALL GOAL, COMPLETION, RESPONSE HANDLING). Preserve section headers and order.`,
        `- Never invent alternate Cartesia tag syntax. Emotion / [laughter] / <break> / <spell> rules stay as written unless the user explicitly changes them.`,
        `- When the user requests a text change (e.g. change "28" to "30", or update a specific phrase), find the exact substring in the system prompt and replace ONLY that. Copy the rest of the system prompt character-for-character.`,
        `- Do NOT rewrite, paraphrase, simplify, reformat, restructure, or shorten any part of the system prompt. The output "systemPrompt" must differ from the input "systemPrompt" only at the exact requested change site(s).`,
        `- Return the full edited system prompt in config.systemPrompt — never truncate it.`,
        `- If the user's request does not touch the system prompt text at all (e.g. voice change, transfer number update), return config.systemPrompt unchanged, copied verbatim from above.`,
        ``,
        `Phone number rules (refine):`,
        `- If "assignedPhoneNumber" above is set, this agent ALREADY has a phone number connected. If the user brings up phone numbers, briefly CONFIRM the existing one — do NOT re-ask or change it unless they explicitly ask for a different number.`,
        `- If the user asks to connect/assign/change a phone number and the [USER PHONE NUMBERS] list has numbers: respond with phase="phone_number" and ready=false so the number cards appear in the chat; once they pick, set phoneNumberId to the exact id and proceed with phase="build".`,
        `- If the list says NONE, point them to the Phone Numbers page to purchase one first.`,
      ].join("\n");
      contextualMessages = [
        { role: "user" as const, content: refineBlock },
        { role: "assistant" as const, content: JSON.stringify({ reply: "Understood — I have the existing agent config and will only update what you ask, keeping everything else unchanged.", phase: "build", ready: false, config: null }) },
        ...contextualMessages,
      ];
    }

    // When the user just clicked a voice card, force the model into call_flow so it
    // cannot strand them with only "okay, we'll use that voice."
    const voicePickHint = !isRefine ? parseVoicePick(lastUserContent(messages)) : null;
    if (voicePickHint) {
      const idPart = voicePickHint.voiceId
        ? ` voiceId=${voicePickHint.voiceId}, voiceName=${voicePickHint.voiceName ?? ""}`
        : voicePickHint.voiceName
          ? ` voiceName=${voicePickHint.voiceName}`
          : "";
      contextualMessages = [
        ...contextualMessages,
        {
          role: "user" as const,
          content: [
            `[SYSTEM TURN RULE — VOICE JUST SELECTED]`,
            `The user clicked Select on a voice card.${idPart}`,
            `In your JSON: set voiceId/voiceName/gender from the [VOICE OPTIONS] list, set phase="call_flow" (never voice_selection), ready=false.`,
            `Your reply must briefly confirm the voice AND ask the call-flow opening question in the same message.`,
          ].join("\n"),
        },
      ];
    }

    const phonePickHint = !isRefine && (looksLikePhoneAssign(lastUserContent(messages)) || looksLikePhoneSkip(lastUserContent(messages)));
    if (phonePickHint) {
      contextualMessages = [
        ...contextualMessages,
        {
          role: "user" as const,
          content: [
            `[SYSTEM TURN RULE — PHONE NUMBER DECISION]`,
            `The user just assigned or skipped an inbound number.`,
            `Set phoneNumberId from the number id they provided (or phoneNumberSkipped=true), set phase="build", ready=true, and say you are building the agent now.`,
          ].join("\n"),
        },
      ];
    }

    let parsed: GeminiVibeResponse;
    try {
      parsed = await callGemini(geminiKey, contextualMessages);
    } catch (err) {
      const kind = err instanceof VibeGeminiError ? err.kind : "unavailable";
      const detail = err instanceof Error ? err.message : String(err);
      logger.warn({ err, kind, detail: detail.slice(0, 400) }, "vibe-chat: Gemini call failed");
      const isClientReject = /Gemini 40[013]/.test(detail);
      // rate_limited + unavailable (timeout/5xx/network) are transient "AI busy"
      // states worth an automatic client retry; malformed/client-reject are not.
      const busy = kind === "rate_limited" || (kind === "unavailable" && !isClientReject);
      emit({
        type: "error",
        retryable: busy,
        message: busy
          ? "Our AI is busy right now — a lot of people are building at the same time. Please wait a few seconds and send your message again."
          : kind === "malformed"
            ? "the AI returned a malformed response. This is usually a one-off — please try again."
            : "the AI request was rejected. Please try again in a moment — if it keeps failing, contact support.",
      });
      res.end();
      return;
    }

    // ── Deterministic phase guards (LLM often confirms without advancing) ──
    const lastUser = lastUserContent(messages);
    const voicePick = parseVoicePick(lastUser);
    if (voicePick) {
      if (parsed.config) {
        const cfgMut = parsed.config;
        const match = availableVoices.find(v =>
          (voicePick.voiceId && v.voiceId === voicePick.voiceId)
          || (voicePick.voiceName && v.voiceName.toLowerCase() === voicePick.voiceName!.toLowerCase()),
        );
        if (match) {
          cfgMut.voiceId = match.voiceId;
          cfgMut.voiceName = match.voiceName;
          if (match.gender === "male" || match.gender === "female") cfgMut.gender = match.gender;
        } else {
          if (voicePick.voiceId) cfgMut.voiceId = voicePick.voiceId;
          if (voicePick.voiceName) cfgMut.voiceName = voicePick.voiceName;
        }
      }
      if (parsed.phase === "voice_selection" || parsed.phase === "core") {
        parsed.phase = "call_flow";
      }
      if (!replyAsksCallFlow(parsed.reply)) {
        const name = parsed.config?.agentName || "the agent";
        // Proposal-first fallback: don't make the user design the script blind.
        // Offer a clean, scannable recommended structure they can accept/tweak/replace.
        parsed.reply = `${parsed.reply.trim()}\n\nHere's a suggested call flow for ${name}:\n\nOpening\n- Greet warmly and introduce ${name}, then say why you're reaching out.\nDiscovery\n- Ask 2–3 quick questions to understand what the caller needs.\nMain pitch\n- Share the key points one at a time, not all at once.\nObjections\n- Answer the common concerns simply and reassure.\nClose\n- Confirm the next step and end on a warm note.\n\nUse it as-is, change any step, or give me your own.`;
      }
    }

    if (!isRefine && looksLikePhoneSkip(lastUser) && parsed.config) {
      parsed.config.phoneNumberSkipped = true;
    }
    if (!isRefine && looksLikePhoneAssign(lastUser) && parsed.config) {
      const idMatch = lastUser.match(/number id\s+(\d+)/i);
      if (idMatch) parsed.config.phoneNumberId = Number(idMatch[1]);
    }
    if (!isRefine && parsed.config && (looksLikePhoneAssign(lastUser) || looksLikePhoneSkip(lastUser))) {
      const c = parsed.config;
      if (c.phoneNumberId != null || c.phoneNumberSkipped) {
        parsed.phase = "build";
        parsed.ready = true;
        if (!/building|build(ing)?\s+/i.test(parsed.reply)) {
          parsed.reply = `${parsed.reply.trim()} Perfect — I have everything I need! Building ${c.agentName || "your agent"} now...`;
        }
      }
    }

    const reply = (parsed.reply ?? "Tell me about the agent you want to build!").trim();
    // Emit the reply in one frame — Gemini has already produced the full text, so
    // fake per-character pacing only added latency. The client animates locally.
    emit({ type: "text", delta: reply });

    const cfg = parsed.config;
    // Normalize: if Gemini set schedulingTools but omitted the boolean flag (LLM output
    // variation), treat scheduling as enabled — the tools array is the stronger signal.
    if (cfg && Array.isArray(cfg.schedulingTools) && cfg.schedulingTools.length > 0 && !cfg.schedulingEnabled) {
      cfg.schedulingEnabled = true;
    }
    // Repair disposition shape before any consumer (disposition cards, system
    // prompt, DB taxonomy) reads it — prevents "undefined:" lines and empty
    // Call Disposition config when the model returns the wrong structure.
    if (cfg) {
      cfg.dispositions = normalizeDispositions(cfg.dispositions);
    }
    const phase = (parsed.phase ?? "core").trim();

    // Emit voice options on EVERY voice_selection-phase turn (not just the first)
    // so the picker can be re-shown ("where are the voices?") and re-ordered when
    // the user changes the agent's language(s) mid-selection.
    let emittedVoiceOptions = false;
    // Never re-show voice cards on the turn the user just picked one.
    if (phase === "voice_selection" && !voicePick) {
      // Agent language(s) for ordering — only when the user actually chose one
      const agentLangs: string[] = parsed.config?.languageChosen
        ? [...new Set([parsed.config.language, ...(parsed.config.multilingualLanguages ?? [])].filter(Boolean))]
        : [];
      const fallbackVoices: VibeVoice[] = [
        { voiceId: DEFAULT_FEMALE_VOICE_ID, voiceName: DEFAULT_FEMALE_VOICE_NAME, gender: "female", language: "en-IN", description: "Indian English — warm female voice" },
        { voiceId: DEFAULT_MALE_VOICE_ID,   voiceName: DEFAULT_MALE_VOICE_NAME,   gender: "male",   language: "en-IN", description: "Indian English — clear male voice"  },
      ];
      try {
        const rows = await db.select().from(platformListedVoicesTable)
          .where(eq(platformListedVoicesTable.isListed, true));
        const voiceList: VibeVoice[] = rows.length > 0
          ? rows.map(v => ({
              voiceId:     v.voiceId,
              voiceName:   v.voiceName,
              gender:      v.gender ?? "neutral",
              language:    v.language,
              description: v.description,
            }))
          : fallbackVoices;
        emit({ type: "voice_options", voices: orderVoicesByLanguage(voiceList, agentLangs), agentLanguages: agentLangs });
      } catch (err) {
        logger.warn({ err }, "vibe-chat: failed to fetch voices, using defaults");
        emit({ type: "voice_options", voices: orderVoicesByLanguage(fallbackVoices, agentLangs), agentLanguages: agentLangs });
      }
      emittedVoiceOptions = true;
    }

    if (!cfg || !cfg.agentName) {
      res.end();
      return;
    }

    // Resolve providers
    const langInfo    = LANG_MAP[cfg.language] ?? LANG_MAP["en-IN"]!;
    const isTamil     = cfg.hasTamil || langInfo.gemini ||
                        (cfg.multilingualLanguages ?? []).includes("ta-IN");
    const llmProvider = isTamil ? "google" : "groq";
    const llmModel    = isTamil ? "gemini-2.5-flash" : "llama-3.3-70b-versatile";
    const langCode    = cfg.languageMode === "multi" ? "en-IN" : langInfo.code;
    const langDisplay = cfg.languageMode === "multi" ? "Multi-language" : langInfo.label;

    // Emit voice_selected to collapse the inline voice picker — ONLY when a pick
    // actually happened this turn (the voiceId differs from what the client already
    // has selected), and NEVER alongside a fresh voice_options in the same response.
    // Prevents refine-mode "cards appear then instantly vanish": the pre-existing
    // config carries a voiceId, which must not count as a new pick.
    const voicePickedThisTurn = !!cfg.voiceId && (cfg.voiceId !== selectedVoiceId || !!voicePick);
    if (voicePickedThisTurn && !emittedVoiceOptions) {
      emit({ type: "voice_selected", voiceId: cfg.voiceId, voiceName: cfg.voiceName });
    }

    // Multi-language heads-up — a visually distinct notice card in the chat.
    // The client dedupes on `signature` so it appears once per language decision.
    if (cfg.languageMode === "multi") {
      const langSet = [...new Set(
        [cfg.language, ...(cfg.multilingualLanguages ?? [])].map(s => String(s ?? "").trim()).filter(Boolean)
      )].sort();
      const nonEnglish = langSet.filter(c => !c.toLowerCase().startsWith("en"));
      if (nonEnglish.length > 0) {
        const labels = nonEnglish.map(c => LANG_MAP[c]?.label ?? c);
        emit({
          type: "notice",
          noticeType: "language",
          signature: `multi:${langSet.join(",")}`,
          message: `Multi-language setup: ${cfg.agentName} will start every call in English (India) — that's the base language shown on the agent — and automatically switch to ${labels.join(", ")} the moment the caller speaks it. None of your language choices are lost.`,
        });
      }
    }

    // Phone-number phase helpers (inbound / "both" agents only). The picked id is
    // validated against the user's own active numbers — never trusted raw.
    const dirTakesInbound = cfg.direction === "inbound" || cfg.direction === "both";
    const pickedNumberIdRaw = cfg.phoneNumberId;
    const pickedNumberId = pickedNumberIdRaw != null && String(pickedNumberIdRaw).trim() !== ""
      ? Number(pickedNumberIdRaw) : null;
    const pickedNumberRow = pickedNumberId != null && Number.isFinite(pickedNumberId)
      ? (userNumbers.find(n => n.id === pickedNumberId) ?? null)
      : null;

    // Helper: resolve the scheduling tools subset from cfg, defaulting to all 5
    function resolveSchedulingTools(c: VibeConfig): string[] {
      const ALL = ["native_booking","native_check_availability","native_list_bookings","native_reschedule","native_cancel"];
      if (!c.schedulingEnabled) return [];
      return (c.schedulingTools?.length) ? c.schedulingTools : ALL;
    }

    // Core field events — labels are plain-English for non-technical builders.
    const coreFields = [
      { key: "name",      label: "Agent name",     value: cfg.agentName,                                                         icon: "bot"      },
      { key: "company",   label: "Company",        value: cfg.companyName || "—",                                                icon: "building" },
      { key: "language",  label: "Language",       value: langDisplay,                                                           icon: "globe"    },
      { key: "direction", label: "Call type",
        value: cfg.direction === "both" ? "Incoming & outgoing" : cfg.direction === "outbound" ? "Outgoing calls" : "Incoming calls",
        icon: "phone" },
      { key: "llm",       label: "Smart replies",  value: "Set up automatically",                                                icon: "cpu"      },
      { key: "stt",       label: "Understands speech", value: "Set up automatically",                                           icon: "ear"      },
      { key: "tts",       label: "Natural voice",  value: "Set up automatically",                                                icon: "speaker"  },
    ];
    if (cfg.voiceId) {
      coreFields.splice(3, 0, { key: "voice", label: "Voice", value: `${cfg.voiceName} — ${cfg.gender === "female" ? "Female" : "Male"}`, icon: "mic" });
    }
    {
      const displayNumber = pickedNumberRow?.number || refineAssignedNumber?.number || "";
      if (dirTakesInbound && (displayNumber || cfg.phoneNumberSkipped || phase === "phone_number" || phase === "build" || parsed.ready)) {
        coreFields.push({ key: "inbound_number", label: "Phone number", value: displayNumber || "Not assigned yet", icon: "phone-incoming" });
      }
    }
    for (const field of coreFields) {
      emit({ type: "field", ...field });
    }

    // Call flow & knowledge base cards
    if (cfg.callFlowNotes) {
      emit({ type: "call_flow", notes: cfg.callFlowNotes });
    }
    if (cfg.knowledgeBaseNotes) {
      // Create (or update) a KB source during the knowledge_base phase so KB content
      // goes through the same ingestKbTextEntries() pipeline as the manual flow.
      // Detects Q&A-formatted content and creates a `faq` source with structured
      // Q/A entries; falls back to `text` for free-form notes.
      try {
        const notes = cfg.knowledgeBaseNotes.trim().slice(0, 15_000);
        if (notes) {
          const bodyKbIds = Array.isArray(knowledgeSourceIds)
            ? knowledgeSourceIds.filter((id): id is number => typeof id === "number" && id > 0)
            : [];
          // Find existing text/faq source from this Vibe session (user may be refining notes)
          const existingKbSource = bodyKbIds.length > 0
            ? await db.select({ id: knowledgeSourcesTable.id, type: knowledgeSourcesTable.type })
                .from(knowledgeSourcesTable)
                .where(and(
                  eq(knowledgeSourcesTable.userId, clerkId),
                  inArray(knowledgeSourcesTable.type, ["text", "faq"]),
                  inArray(knowledgeSourcesTable.id, bodyKbIds),
                ))
                .then(rows => rows[0] ?? null)
                .catch(() => null)
            : null;

          // Detect Q&A-formatted content → create faq source; otherwise text source
          const qaEntries = parseQaEntries(notes);
          const sourceType: "text" | "faq" = qaEntries ? "faq" : "text";
          const entries = qaEntries ?? [{ title: "Knowledge Base Notes", content: notes }];

          // Route through the shared ingestion service — same path as POST /knowledge-sources
          const ingestResult = await ingestKbTextEntries({
            userId:         clerkId,
            sourceName:     `${cfg.agentName ?? "Agent"} — Knowledge Base`,
            type:           sourceType,
            entries,
            existingSourceId: existingKbSource?.id,
          });
          sessionTextKbSourceId = ingestResult.sourceId;

          logger.info(
            { sourceId: ingestResult.sourceId, sourceType, entryCount: entries.length },
            "vibe-chat: KB source upserted via shared ingestion service",
          );
        }
      } catch (kbErr) {
        logger.warn({ kbErr }, "vibe-chat: KB source upsert during knowledge_base phase failed (non-fatal)");
      }
      emit({ type: "knowledge_base", notes: cfg.knowledgeBaseNotes, ...(sessionTextKbSourceId != null ? { kbSourceId: sessionTextKbSourceId } : {}) });
    }

    // Language pills (multilingual)
    if (cfg.languageMode === "multi" && cfg.multilingualLanguages?.length) {
      for (const code of cfg.multilingualLanguages) {
        const info = LANG_MAP[code];
        if (info) emit({ type: "lang_pill", code, label: info.label });
      }
    }

    // Feature cards — emit for every phase past voice/call_flow/kb
    const featurePhases = ["features_gender","features_transfer","features_voicemail",
      "features_scheduling","features_compliance","dispositions","phone_number","build","multilingual"];
    if (featurePhases.includes(phase) || parsed.ready) {
      const features: Array<{ key: string; label: string; enabled: boolean; icon: string; detail: string }> = [
        {
          key: "gender_detection", label: "Caller Gender Detection", icon: "user-check",
          enabled: !!cfg.genderDetectionEnabled,
          detail: cfg.genderDetectionEnabled
            ? `${cfg.maleSalutation || "Sir"} / ${cfg.femaleSalutation || "Ma'am"}`
            : "Disabled — callers addressed neutrally",
        },
        {
          key: "call_transfer", label: "Call Transfer to Human", icon: "phone-forwarded",
          enabled: !!cfg.callTransferEnabled,
          detail: cfg.callTransferEnabled
            ? `→ ${cfg.transferName || "Human Agent"} · ${cfg.transferPhoneNumber}`
            : "Disabled",
        },
        {
          key: "voicemail", label: "Voicemail", icon: "voicemail",
          enabled: !!cfg.voicemailEnabled,
          detail: cfg.voicemailEnabled
            ? (cfg.voicemailMessage ? `"${cfg.voicemailMessage.slice(0, 50)}${cfg.voicemailMessage.length > 50 ? "…" : ""}"` : "Leaves a message")
            : "Disabled",
        },
        {
          key: "scheduling", label: "Booking & Scheduling", icon: "calendar",
          enabled: !!cfg.schedulingEnabled,
          detail: cfg.schedulingEnabled ? "Calendar auto-configured" : "Disabled",
        },
        {
          key: "compliance", label: "Compliance", icon: "shield-check",
          enabled: !!(cfg.compliance?.dpdp || cfg.compliance?.trai || cfg.compliance?.irdai),
          detail: [
            cfg.compliance?.dpdp  && "DPDP",
            cfg.compliance?.trai  && "TRAI",
            cfg.compliance?.irdai && "IRDAI",
          ].filter(Boolean).join(" · ") || "None selected",
        },
      ];
      for (const f of features) {
        emit({ type: "feature", ...f });
      }

      // Tools section — always emit so the preview stays in sync with persistence.
      // schedulingEnabled=false → all 5 emitted as disabled (preview shows none selected, matches DB write of 0 tools).
      // schedulingEnabled=true  → selected subset enabled, rest disabled.
      {
        const ALL_SCHEDULING_TYPES = ["native_booking","native_check_availability","native_list_bookings","native_reschedule","native_cancel"];
        const TOOL_LABELS: Record<string, string> = {
          native_booking:            "Book Appointment",
          native_check_availability: "Check Availability",
          native_list_bookings:      "List Bookings",
          native_reschedule:         "Reschedule Booking",
          native_cancel:             "Cancel Booking",
        };
        const selectedTypes = resolveSchedulingTools(cfg);
        const selectedSet = new Set(selectedTypes);
        emit({
          type:     "tools",
          category: "scheduling",
          label:    "Appointment & Scheduling Tools",
          tools:    ALL_SCHEDULING_TYPES.map(toolType => ({
            toolType,
            label:      TOOL_LABELS[toolType] ?? toolType,
            enabled:    selectedSet.has(toolType),
            status:     selectedSet.has(toolType) ? "selected" : "disabled",
            statusNote: selectedSet.has(toolType) ? "Calendar auto-configured" : undefined,
          })),
        });
      }
    }

    // Phone-number step (inbound / "both" agents): show the user's purchased
    // numbers as in-chat cards, or point to the Phone Numbers page when empty.
    if (dirTakesInbound && userNumbers.length === 0
        && (phase === "phone_number" || (!isRefine && (phase === "build" || parsed.ready)))) {
      emit({
        type: "notice",
        noticeType: "phone_numbers",
        signature: "no-phone-numbers",
        message: "You don't have any phone numbers yet, so nothing is connected for incoming calls. You can purchase one from the Phone Numbers page anytime and connect it to this agent with \"Refine with AI\" — the agent is still being created now.",
      });
    }
    if (dirTakesInbound && phase === "phone_number" && userNumbers.length > 0
        && !pickedNumberRow && !cfg.phoneNumberSkipped) {
      emit({
        type: "phone_number_options",
        numbers: userNumbers.map(n => ({ id: n.id, number: n.number, region: n.region ?? "", assignedAgentId: n.agentId })),
      });
    }
    if (pickedNumberRow) {
      emit({ type: "phone_number_selected", numberId: pickedNumberRow.id, number: pickedNumberRow.number });
    }

    // Disposition cards
    if (cfg.dispositions?.length) {
      emit({ type: "section", id: "dispositions", title: "Call Outcomes" });
      for (const d of cfg.dispositions) {
        emit({ type: "disposition_card", category: d.category, outcomes: d.outcomes });
      }
    }

    // For refine mode: if Gemini returned an updated config (has agentName) proceed
    // to save even if ready flag is false — the refine prompt instructs ready=true on
    // every confirmed change, but we guard here so an incomplete reply still saves.
    if (!parsed.ready && !(isRefine && cfg?.agentName)) {
      res.end();
      return;
    }

    // Call transfer enabled but no phone number captured — ask for it instead of
    // silently saving nothing. The next turn (with the number) will build normally.
    if (cfg.callTransferEnabled && !String(cfg.transferPhoneNumber ?? "").trim()) {
      const ask = "\n\nOne thing before I save — call transfer is enabled, but I don't have a phone number to transfer calls to yet. What number should I use? (Include the country code, e.g. +91XXXXXXXXXX.)";
      emit({ type: "text", delta: ask });
      res.end();
      return;
    }

    // ── Build phase ──────────────────────────────────────────────────────────
    emit({ type: "status", message: "Generating system prompt…" });

    const resolvedVoiceId   = cfg.voiceId   || (cfg.gender === "female" ? DEFAULT_FEMALE_VOICE_ID   : DEFAULT_MALE_VOICE_ID);
    const resolvedVoiceName = cfg.voiceName || (cfg.gender === "female" ? DEFAULT_FEMALE_VOICE_NAME  : DEFAULT_MALE_VOICE_NAME);

    const fallback = `You are ${cfg.agentName}, a voice AI agent for ${cfg.companyName}. Your role is to ${cfg.description}. Be concise, friendly, and professional.${cfg.callTransferEnabled ? ` When the caller needs human help, transfer them to ${cfg.transferName || "our support team"} at ${cfg.transferPhoneNumber}.` : ""} Always introduce yourself at the start of each call.`;
    let systemPrompt = fallback;

    // Refine-mode short-circuit: if Gemini returned an edited system prompt, use it
    // directly and skip all regeneration. This preserves surgical edits verbatim.
    // If isRefine but cfg.systemPrompt is empty (prompt untouched by refine), fall back
    // to the authoritative DB copy rather than generating a fresh one.
    if (isRefine) {
      if (cfg.systemPrompt) {
        systemPrompt = cfg.systemPrompt;
      } else if (existingAgentRow?.systemPrompt) {
        systemPrompt = String(existingAgentRow.systemPrompt);
      }
      // Skip regeneration — refine keeps surgical edits.
    } else {
      // Proven section pattern (IDENTITY → LANGUAGE → TONE → FLOW → Cartesia → …).
      // Dynamic slots from Vibe config; speech/Cartesia rules are stable — not free-form LLM invention.
      try {
        systemPrompt = buildPatternSystemPrompt({
          agentName:              cfg.agentName,
          companyName:            cfg.companyName,
          description:            cfg.description,
          language:               cfg.language,
          langDisplay,
          languageMode:           cfg.languageMode === "multi" ? "multi" : "single",
          multilingualLanguages:  cfg.multilingualLanguages ?? [],
          direction:              cfg.direction || "inbound",
          callFlowNotes:          cfg.callFlowNotes ?? "",
          mandatoryQuestions:     cfg.mandatoryQuestions ?? "",
          agentRules:             cfg.agentRules ?? "",
          callbackGreeting:       cfg.callbackGreeting ?? "",
          dispositionLogic:       cfg.dispositionLogic ?? "",
          greetingMessage:        cfg.greetingMessage,
          genderDetectionEnabled: !!cfg.genderDetectionEnabled,
          maleSalutation:         cfg.maleSalutation || "Sir",
          femaleSalutation:       cfg.femaleSalutation || "Ma'am",
          callTransferEnabled:    !!cfg.callTransferEnabled,
          transferPhoneNumber:    cfg.transferPhoneNumber || "",
          transferName:           cfg.transferName || "",
          voicemailEnabled:       !!cfg.voicemailEnabled,
          voicemailMessage:       cfg.voicemailMessage || "",
          schedulingEnabled:      !!cfg.schedulingEnabled,
          compliance:             cfg.compliance ?? {},
          dispositions:           cfg.dispositions ?? [],
        });
      } catch (err) {
        logger.warn({ err }, "vibe-chat: pattern prompt build failed, using fallback");
      }
    }

    const preview = systemPrompt.slice(0, 300);
    emit({ type: "prompt_stream", delta: preview });
    if (systemPrompt.length > 300) emit({ type: "prompt_stream", delta: "…" });

    emit({ type: "status", message: "Creating your agent…" });

    // Build agentConfig object
    const agentTimezone = (cfg.timezone?.trim() || "Asia/Kolkata");
    const agentConfig: Record<string, unknown> = {
      recordingEnabled:     true,
      summarizationEnabled: true,
      languageAutoDetect:   cfg.languageMode === "multi",
      isMultilingual:       cfg.languageMode === "multi",
      direction:            cfg.direction || "inbound",
      // India-first default — always persist so the Prompt tab never shows "Not set"
      // and datetime injection / calendars share the same zone.
      timezone:             agentTimezone,
    };
    if (cfg.direction === "outbound") {
      agentConfig.autoRedial = { enabled: true, maxAttempts: 3 };
    }
    if (cfg.languageMode === "multi" && cfg.multilingualLanguages?.length) {
      agentConfig.multilingualLanguages = cfg.multilingualLanguages;
    }
    // Always persist the toggle explicitly (true OR false) so the backend's
    // missing-field default never has to guess for vibe-created agents.
    agentConfig.genderDetectionEnabled = !!cfg.genderDetectionEnabled;
    if (cfg.genderDetectionEnabled) {
      agentConfig.genderDetectionMaleSalutation   = cfg.maleSalutation   || "Sir";
      agentConfig.genderDetectionFemaleSalutation = cfg.femaleSalutation || "Ma'am";
    }
    // Pre-existing agentConfig (refine mode only) — used to preserve edit-page
    // voicemail choices and to merge instead of clobbering unrelated keys.
    const existingAcfg: Record<string, unknown> = isRefine
      ? ((existingAgentRow?.agentConfig ?? {}) as Record<string, unknown>)
      : {};
    if (cfg.voicemailEnabled) {
      // Write the canonical UI shape (machineDetectionMode) so the builder/edit
      // Voicemail tab reflects it; keep the legacy boolean for backward compat.
      agentConfig.voicemailDetection = true;
      const existingMode = String(existingAcfg["machineDetectionMode"] ?? "");
      agentConfig.machineDetectionMode =
        existingMode && existingMode !== "disabled" ? existingMode : "detect_message_end";
      const existingAction = String(existingAcfg["voicemailAction"] ?? "");
      if (cfg.voicemailMessage) {
        agentConfig.voicemailAction  = "leave_message";
        agentConfig.voicemailMessage = cfg.voicemailMessage;
      } else if (isRefine && existingAction) {
        // Refine with no message captured — keep the edit-page action untouched.
        agentConfig.voicemailAction = existingAction;
      } else {
        agentConfig.voicemailAction  = "leave_message";
        agentConfig.voicemailMessage = "";
      }
    } else if (isRefine) {
      // User explicitly has voicemail off in refine — write the disable in both
      // shapes so the merge below doesn't resurrect a previously-enabled state.
      agentConfig.voicemailDetection   = false;
      agentConfig.machineDetectionMode = "disabled";
    }
    if (cfg.schedulingEnabled) {
      agentConfig.schedulingGuardrails = true;
    }
    if (cfg.callTransferEnabled && cfg.transferPhoneNumber) {
      agentConfig.callTransferEnabled = true;
      agentConfig.transferPhoneNumber = cfg.transferPhoneNumber;
      agentConfig.transferName        = cfg.transferName || "Human Agent";
    } else if (isRefine) {
      // Transfer off in refine — disable explicitly so the merge doesn't keep it on.
      agentConfig.callTransferEnabled = false;
    }
    const comp = cfg.compliance ?? { dpdp: false, trai: false, irdai: false };
    if (comp.dpdp || comp.trai || comp.irdai) {
      agentConfig.compliance = comp;
    }

    // Greeting — always a simple opener; the system prompt handles the full intro.
    // Only honour a user-typed quoted line from their call-flow notes.
    function buildGreeting(_name: string, _company: string, lang: string, callFlowNotes: string | undefined): string {
      if (callFlowNotes) {
        // Only match double-quotes (straight " or curly "" ) — never apostrophes/single-quotes,
        // which are common mid-word (e.g. "customer's") and cause partial-phrase extraction.
        const q = callFlowNotes.match(/[""][^""]{8,80}[""]/);
        if (q) return q[0].slice(1, -1);
      }
      // Simple locale greeting — no name/company at all.
      // The system prompt teaches the agent to introduce itself after the caller responds.
      switch (lang) {
        case "ta-IN": return "வணக்கம்!";
        case "hi-IN": return "नमस्ते!";
        case "te-IN": return "నమస్కారం!";
        case "kn-IN": return "ನಮಸ್ಕಾರ!";
        case "ml-IN": return "നമസ്കാരം!";
        case "mr-IN": return "नमस्कार!";
        case "bn-IN": return "হ্যালো!";
        case "gu-IN": return "નમસ્તે!";
        case "pa-IN": return "ਸਤ ਸ੍ਰੀ ਅਕਾਲ!";
        default:      return "Hello!";
      }
    }
    // In refine modee mode, preserve the agent's existing greeting unless the user explicitly
    // changed it (Gemini carries it forward in cfg.greetingMessage from the refine context).
    const greetingMessage = (isRefine && cfg.greetingMessage)
      ? cfg.greetingMessage
      : buildGreeting(cfg.agentName, cfg.companyName, langCode, cfg.callFlowNotes);

    // Build tools array — matches the JSON shape the builder reads from agent.tools
    const tools: Record<string, unknown>[] = [];
    // End-call tool: always enabled so agent can gracefully end calls
    tools.push({ type: "end_call", name: "end_call", description: "End the call when the conversation is complete." });
    // Call-transfer tool: added when transfer was configured. In refine mode,
    // preserve the fields of an existing call_transfer tool (name, mode, custom
    // description) and only update the destination number.
    if (cfg.callTransferEnabled && cfg.transferPhoneNumber) {
      const existingToolsForTransfer = isRefine && Array.isArray(existingAgentRow?.tools)
        ? (existingAgentRow!.tools as Record<string, unknown>[])
        : [];
      const existingTransferTool = existingToolsForTransfer.find(t => t?.["type"] === "call_transfer");
      if (existingTransferTool) {
        tools.push({ ...existingTransferTool, transferTo: cfg.transferPhoneNumber });
      } else {
        tools.push({
          type: "call_transfer",
          name: "transfer_to_human",
          description: `Transfer the call to ${cfg.transferName || "a human agent"} when the caller requests it or you cannot resolve their issue.`,
          transferTo: cfg.transferPhoneNumber,
          transferMode: "cold",
        });
      }
    }
    // Scheduling tools: added for the exact subset the user confirmed
    const nameMap: Record<string, string> = {
      native_booking:              "book_appointment",
      native_check_availability:   "check_availability",
      native_list_bookings:        "list_bookings",
      native_reschedule:           "reschedule_booking",
      native_cancel:               "cancel_booking",
    };
    resolveSchedulingTools(cfg).forEach(type => {
      tools.push({ type, name: nameMap[type] ?? type, description: "", timezone: agentTimezone });
    });

    // DB insert or update — agent
    let insertedAgent: { id: number; name: string };

    // For refine: prefer the AI-returned voice if it differs from existing,
    // otherwise fall back to the existing DB voice so an unmentioned voice is never
    // overwritten with a gender-default when the AI omits voiceId in a partial config.
    const existingTtsVoice     = existingAgentRow?.ttsVoice as string | undefined;
    const existingTtsVoiceName = existingAgentRow?.ttsVoiceName as string | undefined;
    const finalVoiceId   = isRefine
      ? (cfg.voiceId   || existingTtsVoice   || resolvedVoiceId)
      : resolvedVoiceId;
    const finalVoiceName = isRefine
      ? (cfg.voiceName || existingTtsVoiceName || resolvedVoiceName)
      : resolvedVoiceName;

    // Refine mode: merge the vibe-built agentConfig into the existing one instead
    // of replacing it wholesale — pre-existing keys the vibe flow doesn't manage
    // (advanced settings, webhook secret, barge-in tuning, …) are preserved
    // exactly. Same for tools: keep every existing tool untouched, reconcile only
    // the call_transfer tool, and add vibe-built tools that don't already exist.
    let agentConfigToSave: Record<string, unknown> = agentConfig;
    let toolsToSave: Record<string, unknown>[] = tools;
    if (isRefine && existingAgentRow) {
      agentConfigToSave = { ...existingAcfg, ...agentConfig };
      const existingTools = Array.isArray(existingAgentRow.tools)
        ? (existingAgentRow.tools as Record<string, unknown>[])
        : [];
      // Drop the existing call_transfer tool — it is reconciled from the vibe
      // build (re-added when transfer is enabled, removed when disabled).
      const keptTools = existingTools.filter(t => t?.["type"] !== "call_transfer");
      const addedTools = tools.filter(t =>
        t["type"] === "call_transfer" || !keptTools.some(e => e?.["type"] === t["type"])
      );
      toolsToSave = [...keptTools, ...addedTools];
    }

    try {
      if (isRefine) {
        // Refine mode: update the existing agent (scoped to this user for security).
        // existingAgentRow was fetched at request start — reuse it here.
        const [row] = await (db.update(agentsTable) as any)
          .set({
            name:                     cfg.agentName,
            asrLanguage:              langCode,
            language:                 langCode,
            llmProvider,
            llmModel,
            asrProvider:              (existingAgentRow?.asrProvider as string) ?? "sarvam",
            asrModel:                 (existingAgentRow?.asrModel as string) ?? "saaras:v3",
            ttsProvider:              (existingAgentRow?.ttsProvider as string) ?? "cartesia",
            ttsModel:                 (existingAgentRow?.ttsModel as string) ?? "sonic-3.5",
            telephonyProvider:        (existingAgentRow?.telephonyProvider as string) ?? "vobiz",
            ttsVoice:                 finalVoiceId,
            ttsVoiceName:             finalVoiceName,
            systemPrompt,
            greetingMessage,
            backchannelingEnabled:    true,
            noiseCancellationEnabled: true,
            agentConfig:              agentConfigToSave as any,
            tools:                    toolsToSave as any,
          })
          .where(and(eq(agentsTable.id, refineAgentId), eq(agentsTable.userId, clerkId)))
          .returning();
        if (!row) throw new Error(`Agent ${refineAgentId} not found or not owned by user`);
        insertedAgent = row;
      } else {
        // NEW agents get Bolna Call Engine safe defaults (same as POST /agents).
        const tunedAdvancedDefaults: Record<string, unknown> = {
          ...callEngineInsertDefaults(),
          ttsMinSentenceChars:     18,
          llmMaxTokens:            150,
          startSpeakingPlan:       { waitSeconds: 0, onPunctuationSeconds: 0.1, onNoPunctuationSeconds: 0.1, onNumberSeconds: 0 },
          autoRedial:              { enabled: true, maxAttempts: 3 },
          // sarvamSttMode omitted — resolved per language at call start (en-IN → transcribe)
        };
        const [row] = await db.insert(agentsTable).values({
          userId:                   clerkId,
          name:                     cfg.agentName,
          asrProvider:              "sarvam",
          asrModel:                 "saaras:v3",
          asrLanguage:              langCode,
          language:                 langCode,
          llmProvider,
          llmModel,
          ttsProvider:              "cartesia",
          ttsModel:                 "sonic-3.5",
          ttsVoice:                 resolvedVoiceId,
          telephonyProvider:        "vobiz",
          systemPrompt,
          greetingMessage,
          maxDuration:              480,
          backchannelingEnabled:    true,
          noiseCancellationEnabled: true,
          agentConfig:              { ...tunedAdvancedDefaults, ...agentConfig } as any,
          tools:                    tools as any,
        } as any).returning();
        insertedAgent = row;
      }
    } catch (dbErr) {
      logger.error({ dbErr }, "vibe-chat: agent DB save failed");
      emit({ type: "error", message: "Failed to save agent. Please try again." });
      res.end();
      return;
    }

    // KB source attachment ─────────────────────────────────────────────────────
    // Collect IDs supplied by the frontend (from file uploads during this session)
    const rawKbIds = Array.isArray(knowledgeSourceIds)
      ? knowledgeSourceIds.filter((id): id is number => typeof id === "number" && id > 0)
      : [];
    const allKbSourceIds: number[] = [...rawKbIds];

    // Include the text KB source created during the knowledge_base SSE phase this turn
    // (covers the case where build fires on the same stream as knowledge_base emit)
    if (sessionTextKbSourceId != null && !allKbSourceIds.includes(sessionTextKbSourceId)) {
      allKbSourceIds.push(sessionTextKbSourceId);
    }

    // Attach validated, terminal-success source IDs to the agent (ownership-checked, idempotent).
    // Only status in {active, ready, partial} is considered successfully indexed.
    if (allKbSourceIds.length > 0) {
      try {
        const uniqueIds = Array.from(new Set(allKbSourceIds));
        const TERMINAL_SUCCESS = ["active", "ready", "partial"];
        const ownedRows = await db.select({ id: knowledgeSourcesTable.id })
          .from(knowledgeSourcesTable)
          .where(and(
            eq(knowledgeSourcesTable.userId, clerkId),
            inArray(knowledgeSourcesTable.id, uniqueIds),
            inArray(knowledgeSourcesTable.status, TERMINAL_SUCCESS),
          ));
        const ownedIds = ownedRows.map(r => r.id);
        if (ownedIds.length > 0) {
          await db.insert(agentKnowledgeSourcesTable)
            .values(ownedIds.map(sourceId => ({ agentId: insertedAgent.id, sourceId })))
            .onConflictDoNothing();
        }
      } catch (kbErr) {
        logger.warn({ kbErr }, "vibe-chat: KB source attachment failed (non-fatal)");
      }
    }

    // Inbound phone-number assignment (vibe phone_number phase) — mirrors
    // PATCH /phone-numbers/:id/assign. Non-fatal: agent creation already succeeded.
    // pickedNumberRow is validated against the user's own active numbers above.
    if (pickedNumberRow && pickedNumberRow.agentId !== insertedAgent.id) {
      try {
        const [numRow] = await db.update(phoneNumbersTable)
          .set({ agentId: insertedAgent.id })
          .where(and(eq(phoneNumbersTable.id, pickedNumberRow.id), eq(phoneNumbersTable.userId, clerkId)))
          .returning();
        if (numRow) {
          await db.update(agentsTable)
            .set({ inboundPhoneNumberId: numRow.id, outboundPhoneNumberId: numRow.id })
            .where(and(eq(agentsTable.id, insertedAgent.id), eq(agentsTable.userId, clerkId)));
          await logActivity({
            userId:       clerkId,
            eventType:    "phone_number.assigned",
            resourceType: "phone_number",
            resourceId:   String(numRow.id),
            description:  `Phone number ${numRow.number} assigned to agent #${insertedAgent.id}`,
          });
          emit({ type: "field", key: "inbound_number", label: "Inbound Number", value: numRow.number, icon: "phone-incoming" });
        }
      } catch (err) {
        logger.warn({ err, numberId: pickedNumberRow.id, agentId: insertedAgent.id }, "vibe-chat: phone number assignment failed (non-fatal)");
        emit({
          type: "notice",
          noticeType: "phone_numbers",
          signature: `assign-failed-${pickedNumberRow.id}`,
          message: `I couldn't connect ${pickedNumberRow.number} automatically — you can assign it from the Phone Numbers page.`,
        });
      }
    }

    // DB insert/upsert — dispositions
    // For refine mode: use onConflictDoUpdate so changes are reflected immediately.
    // For new agents: onConflictDoNothing (the row shouldn't exist yet).
    // If refine returns empty dispositions the user didn't touch them — skip write.
    if (cfg.dispositions?.length) {
      const taxonomy: Record<string, string[]> = {};
      for (const d of cfg.dispositions) {
        taxonomy[d.category] = d.outcomes;
      }
      const dispInsert = db.insert(agentDispositionsTable)
        .values({ agentId: insertedAgent.id, taxonomy, domainFields: [], rules: [] });
      (isRefine
        ? dispInsert.onConflictDoUpdate({
            target: [agentDispositionsTable.agentId],
            set: { taxonomy },
          })
        : dispInsert.onConflictDoNothing()
      ).catch(err => logger.warn({ err }, "vibe-chat: disposition upsert failed"));
    }

    // DB insert — scheduling calendar + availability + default event type
    if (cfg.schedulingEnabled) {
      try {
        const [cal] = await db.insert(schedulingCalendarsTable)
          .values({
            userId:    clerkId,
            name:      `${cfg.agentName} Calendar`,
            timezone:  agentTimezone,
            hostEmail: cfg.hostEmail || null,
            isActive:  true,
          })
          .returning();

        // Link the new calendar to this agent via calendarCapability
        if (cal) {
          await db.update(agentsTable)
            .set({
              agentConfig: sql`coalesce(${agentsTable.agentConfig}, '{}'::jsonb) || ${JSON.stringify({ calendarCapability: { enabled: true, defaultCalendarId: cal.id } })}::jsonb`,
            })
            .where(eq(agentsTable.id, insertedAgent.id))
            .catch(err => logger.warn({ err }, "vibe-chat: calendarCapability link failed (non-fatal)"));
        }
      } catch (err) {
        logger.warn({ err }, "vibe-chat: scheduling setup failed (non-fatal)");
      }

      // Emit scheduling setup card for the frontend
      emit({
        type:              "scheduling_setup",
        timezone:          agentTimezone,
        hostEmail:         cfg.hostEmail || "",
        availabilityDays:  cfg.availabilityDays || [1,2,3,4,5],
        connectCalendarUrl: "/app/scheduling",
        eventTypesUrl:     "/app/scheduling",
      });
    } else {
      // Fallback: even when cfg.schedulingEnabled was falsy (LLM omitted the flag
      // or reset it during refine), if a scheduling calendar already exists for this
      // agent (e.g. from a prior creation or a refine that preserved it), surface the
      // wizard so the user can complete setup without recreating the agent.
      try {
        const insertedAgentCap = (insertedAgent as any).agentConfig?.calendarCapability;
        const existingCalId: number | null = insertedAgentCap?.enabled && insertedAgentCap?.defaultCalendarId != null
          ? insertedAgentCap.defaultCalendarId : null;
        const [existingCal] = existingCalId != null
          ? await db.select({ id: schedulingCalendarsTable.id, timezone: schedulingCalendarsTable.timezone })
              .from(schedulingCalendarsTable)
              .where(eq(schedulingCalendarsTable.id, existingCalId))
              .limit(1)
          : [];
        if (existingCal) {
          emit({
            type:              "scheduling_setup",
            timezone:          existingCal.timezone ?? agentTimezone,
            hostEmail:         cfg.hostEmail || "",
            availabilityDays:  [1,2,3,4,5],
            connectCalendarUrl: "/app/scheduling",
            eventTypesUrl:     "/app/scheduling",
          });
        }
      } catch (err) {
        logger.warn({ err }, "vibe-chat: scheduling fallback check failed (non-fatal)");
      }
    }

    await logActivity({
      userId:       clerkId,
      eventType:    isRefine ? "agent.updated" : "agent.created",
      resourceType: "agent",
      resourceId:   String(insertedAgent.id),
      description:  isRefine
        ? `Agent "${insertedAgent.name}" refined via Vibe Builder`
        : `Agent "${insertedAgent.name}" created via Vibe Builder`,
    });

    void trackEvent(clerkId, isRefine ? "vibe_refined" : "vibe_completed", { agentId: insertedAgent.id });
    emit({ type: "created", agentId: insertedAgent.id, agentName: cfg.agentName });
    res.end();

  } catch (err) {
    logger.error({ err }, "vibe-chat: unhandled error");
    try {
      emit({ type: "error", message: "Something went wrong. Please try again." });
      res.end();
    } catch { /* already closed */ }
  }
});

export default router;
