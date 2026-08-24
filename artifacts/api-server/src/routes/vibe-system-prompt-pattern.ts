/**
 * Production system-prompt pattern for Vibe Builder.
 *
 * Structure is derived from a proven high-performing agent prompt
 * (IDENTITY → LANGUAGE → TONE → GENDER → CALL FLOW → INTERRUPTIONS →
 * KB → OBJECTIONS → ERRORS → CARTESIA → HUMAN SPEECH RULES → GOAL →
 * COMPLETION → RESPONSE HANDLING). Dynamic content comes from the Vibe
 * config; Cartesia / speech rules are stable and never free-form reinvented.
 */

export interface VibePatternPromptInput {
  agentName: string;
  companyName: string;
  description: string;
  language: string;
  langDisplay: string;
  languageMode: "single" | "multi";
  multilingualLanguages: string[];
  direction: "inbound" | "outbound" | "both";
  callFlowNotes: string;
  mandatoryQuestions: string;
  agentRules: string;
  callbackGreeting: string;
  dispositionLogic: string;
  greetingMessage?: string;
  genderDetectionEnabled: boolean;
  maleSalutation: string;
  femaleSalutation: string;
  callTransferEnabled: boolean;
  transferPhoneNumber: string;
  transferName: string;
  voicemailEnabled: boolean;
  voicemailMessage: string;
  schedulingEnabled: boolean;
  compliance: { dpdp?: boolean; trai?: boolean; irdai?: boolean };
  dispositions: Array<{ category: string; outcomes: string[] }>;
}

function section(title: string, body: string): string {
  return `**${title}**\n\n${body.trim()}\n`;
}

function languageStyleBlock(input: VibePatternPromptInput): string {
  const multi = input.languageMode === "multi" && input.multilingualLanguages.length > 0;
  const langs = multi
    ? [...new Set([input.language, ...input.multilingualLanguages])].filter(Boolean)
    : [input.language];

  const lines: string[] = [];
  if (multi) {
    lines.push(
      `Speak primarily in ${input.langDisplay}. IF THE USER SWITCHES LANGUAGE, CONTINUE IN THE LANGUAGE THEY SWITCHED TO.`,
      `Supporting languages: ${langs.join(", ")}.`,
      `Start calls in English (India) as the platform base language when multilingual auto-detect is on, then follow the caller.`,
    );
  } else {
    lines.push(`Speak in everyday, casual ${input.langDisplay}.`);
    lines.push(`Switch to another language only if the user explicitly asks.`);
  }

  lines.push(
    `Mix English naturally for business terms (policy, renewal, discount, application, doctor consultation, etc.). Prefer English for business terms over forced translation.`,
    `Don't use the user's name too often.`,
    ``,
    `Say ALL numbers strictly as English words — never local-language number words or raw digits in speech.`,
    `Applies to: ages, amounts, durations, times, sums, phone numbers, pincodes, and any other numeric data.`,
    ``,
    `CORRECT: "thirty six months", "four thirty PM", "two hundred lakhs"`,
    `WRONG: mixing local number words with English units, or dumping digit strings.`,
    ``,
    `Never sound scripted.`,
    `Never deliver formal or elaborate explanations.`,
  );

  return lines.join("\n");
}

function toneBlock(input: VibePatternPromptInput): string {
  const purpose = input.description?.trim() || "help the caller with their request";
  return [
    `This is a ${input.direction === "outbound" || input.direction === "both" ? "friendly outbound" : "friendly inbound"} conversation for ${input.companyName || "the company"}.`,
    `Purpose: ${purpose}`,
    ``,
    `Tone rules:`,
    `Don't dump information — share one useful idea at a time.`,
    `Don't push hard — guide naturally and let the customer lead the pace.`,
    `Don't close like a hard sale — end warm and human.`,
    `If customer sounds disinterested — slow down, soften, don't push harder.`,
    `If customer sounds curious — match their energy warmly.`,
    ``,
    `Sentence style:`,
    `Mix short punchy sentences with slightly longer ones.`,
    `Sound spoken, not read.`,
    `One idea per sentence. Let it breathe.`,
  ].join("\n");
}

function genderBlock(input: VibePatternPromptInput): string {
  if (!input.genderDetectionEnabled) {
    return [
      `Address the caller warmly without gendered titles unless they state a preference.`,
      `If they ask to be addressed a certain way, honor that for the rest of the call.`,
    ].join("\n");
  }
  const male = input.maleSalutation || "Sir";
  const female = input.femaleSalutation || "Ma'am";
  return [
    `The moment {{caller_salutation}} is available, map it to the appropriate honorific and use it consistently throughout the entire call.`,
    `Default mapping: male → "${male}", female → "${female}".`,
    ``,
    `Override Rule:`,
    `If the caller at any point asks to be addressed differently (e.g., by name, or without a title), immediately switch and maintain that preference for the rest of the call.`,
    `Do not revert to the original honorific after an override.`,
  ].join("\n");
}

function splitFlowNotes(notes: string): string[] {
  const cleaned = notes.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];
  // Prefer blank-line / numbered / bullet breaks; else keep as one block
  const byBlank = cleaned.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (byBlank.length >= 2) return byBlank;
  const byLine = cleaned.split(/\n/).map(s => s.trim()).filter(Boolean);
  if (byLine.length >= 2 && byLine.every(l => /^(\d+[\).\]]\s+|[-*•]\s+)/.test(l) || l.length < 220)) {
    return byLine.map(l => l.replace(/^(\d+[\).\]]\s+|[-*•]\s+)/, ""));
  }
  return [cleaned];
}

function callFlowBlock(input: VibePatternPromptInput): string {
  const name = input.agentName || "the agent";
  const company = input.companyName || "the company";
  const parts: string[] = [];

  const opening =
    input.greetingMessage?.trim()
    || (input.direction === "outbound" || input.direction === "both"
      ? `Introduce yourself as ${name} from ${company}, state the reason for calling in one sentence, then ask a short permission question. Wait for response before continuing.`
      : `Introduce yourself as ${name} from ${company} and warmly ask how you can help. Wait for response before continuing.`);

  parts.push(`**Welcome / Opening**`);
  parts.push(`⚠️ If caller history / {prior_facts} exists, skip the first-time-only welcome and pick up naturally.`);
  parts.push(`For first-time callers, open with:`);
  parts.push(opening);
  parts.push(`This opening must be said clearly. Wait for customer response before continuing.`);
  parts.push(`If busy / driving: do not force the pitch — offer a later callback or end politely.`);
  parts.push(``);

  const steps = splitFlowNotes(input.callFlowNotes);
  if (steps.length === 0) {
    parts.push(`**Main conversation**`);
    parts.push(`Help with: ${input.description || "the caller's request"}.`);
    parts.push(`One idea at a time. Pause. Wait for response. Then continue.`);
    parts.push(`Always answer the user's queries before dumping the next point.`);
  } else {
    steps.forEach((step, i) => {
      parts.push(`**Step ${i + 1}**`);
      parts.push(step);
      parts.push(`Wait for response. Then continue.`);
      parts.push(``);
    });
  }

  if (input.mandatoryQuestions?.trim()) {
    parts.push(`**Mandatory questions**`);
    parts.push(`You must ask the following on every call, in this exact order — do not skip even if the caller seems ready to close:`);
    parts.push(input.mandatoryQuestions.trim());
    parts.push(`Wait for answers. Never rush through.`);
    parts.push(``);
  }

  if (input.callbackGreeting?.trim()) {
    parts.push(`**Returning callers**`);
    parts.push(`If {prior_facts} has information, recognise a returning caller and do NOT restart from scratch.`);
    parts.push(input.callbackGreeting.trim());
    parts.push(``);
  } else {
    parts.push(`**Returning callers**`);
    parts.push(`The platform provides {prior_facts}. If it contains information, acknowledge what you know and pick up from there. If empty, treat the caller as new.`);
    parts.push(``);
  }

  parts.push(`**Warm Closing**`);
  parts.push(`Do not close abruptly.`);
  parts.push(`Do not sound like you are wrapping up a sales pitch.`);
  parts.push(`In one casual line, remind them of the helpful next step (if any).`);
  parts.push(`Close warmly and ask if they have any final questions.`);
  parts.push(`Pause for any final response before ending.`);

  if (input.dispositionLogic?.trim() || input.dispositions?.length) {
    parts.push(``);
    parts.push(`**Call outcomes**`);
    if (input.dispositionLogic?.trim()) {
      parts.push(`After every call, tag the outcome using this logic: ${input.dispositionLogic.trim()}`);
    }
    const validDispositions = (input.dispositions ?? []).filter(
      d => d && typeof d.category === "string" && d.category.trim() && (d.outcomes ?? []).length,
    );
    if (validDispositions.length) {
      parts.push(`Outcome categories:`);
      for (const d of validDispositions) {
        parts.push(`- ${d.category}: ${(d.outcomes ?? []).join(" / ")}`);
      }
    }
  }

  return parts.join("\n");
}

function objectionsBlock(input: VibePatternPromptInput): string {
  const lines: string[] = [];
  if (input.agentRules?.trim()) {
    lines.push(`Strict DOs and DON'Ts from the business:`);
    lines.push(input.agentRules.trim());
    lines.push(``);
  }
  lines.push(`General objection pattern:`);
  lines.push(`If customer is uncertain — simplify, reassure in 2–3 connected thoughts, then return to the current step.`);
  lines.push(`If customer is busy — ask for a better time and end politely without forcing next steps.`);
  lines.push(`If a topic needs specialist detail — say a senior executive will follow up, then return to the current step.`);
  lines.push(`After objections: return to exactly where you left off in the call flow.`);
  if (input.callTransferEnabled) {
    lines.push(``);
    lines.push(`Transfer:`);
    lines.push(`When the caller explicitly asks for a human, or you cannot resolve after two genuine attempts, transfer to ${input.transferName || "a human agent"}${input.transferPhoneNumber ? ` at ${input.transferPhoneNumber}` : ""}.`);
    lines.push(`Say you are connecting them, then use the transfer tool. Do not transfer for minor objections.`);
  }
  return lines.join("\n");
}

function complianceExtra(input: VibePatternPromptInput): string {
  const bits: string[] = [];
  if (input.compliance?.dpdp) {
    bits.push(`DPDP: At the start when appropriate, note the call may be recorded and continuing implies consent to data processing under the DPDP Act.`);
  }
  if (input.compliance?.trai) {
    bits.push(`TRAI: State the purpose of the call clearly within the first 30 seconds. If the caller says they are on DNC/DND, apologise and end immediately.`);
  }
  if (input.compliance?.irdai) {
    bits.push(`IRDAI: Never make exaggerated claims about returns or coverage. Always say "subject to terms and conditions".`);
  }
  if (input.voicemailEnabled && input.voicemailMessage?.trim()) {
    bits.push(`Voicemail (if unanswered on outbound): "${input.voicemailMessage.trim()}"`);
  }
  if (input.schedulingEnabled) {
    bits.push(`Scheduling tools are available — book / check availability / list / reschedule / cancel as enabled. Confirm details before writing bookings.`);
  }
  return bits.join("\n");
}

/**
 * Stable Cartesia block — MUST match pipeline extractEmotionTag + mapEmotionToCartesia
 * and session.ts TTS OUTPUT RULES. Wrong syntax (wrap tags / unsupported emotion names)
 * is stripped from transcripts and does nothing for voice controls.
 */
export const CARTESIA_SPEECH_BLOCK = `**SPEECH SYNTHESIS — CARTESIA SONIC 3.5**

Strictly never read tags or emotion names aloud to the user.
The ONLY markup allowed is the four delivery signals below. Never invent other XML/SSML tags.

**Written Form (Sonic normalizes this for you)**

Write plain, well-punctuated prose in full sentences and end every turn with . ? or !
Send complete phrases — never a bare code, number, or spell tag on its own line.
Use normal capitalization. Keep real acronyms in their standard form (USA, NASA); never put ordinary words in caps for emphasis, they get read letter by letter.
Leave numbers, currency, percentages, phone numbers, addresses and emails in conventional written form (1,234,567 · $19.99 · 12% · (415) 555-1212 · 123 Main St · user@example.com). Do not pre-spell them out.
Never use markdown, bullets, asterisks or emoji — they are spoken aloud literally.

**Emotion Tags (REQUIRED on meaningful turns)**

Place a self-closing emotion tag at the VERY START of the spoken sentence — never mid-sentence, never mid-word, never more than once per sentence, never wrap text.

ONLY these values work on the platform (anything else is ignored):
- enthusiastic — welcome, good news, warm energy
- curious — asking a question / gathering info
- content — confirmation, successful step, calm positive
- sympathetic — empathy / softening when customer is hesitant or upset
- calm — reset after emotion or a sensitive moment
- sad — delivering genuinely bad news (rare)

Syntax (exact — self-closing, leading):
CORRECT: <emotion value="curious"/> hmm நீங்க app install பண்ணிருக்கீங்களா?
WRONG: <emotion value="excited">Hello!</emotion>
WRONG: mid-sentence tags, stacking two emotions, or inventing values like "happy" / "grateful"

Use an emotion tag on nearly every agent turn that advances the call (greeting, each benefit, questions, close). Plain no-tag speech only for ultra-short fillers like "okay" / "சரி".

**Laughter**

Use [laughter] only when the customer makes a clear joke.
Do not use during serious, sensitive, or objection-handling moments.
If customer asks "are you AI?" — deflect calmly in persona without laughter.

Example: That's a good one! [laughter] Let me check that for you.

**Pauses and Breaks**

Use <break time="500ms"/> sparingly at a natural pause before an important point or topic shift.
Do not chain multiple break tags. Do not use tiny 50ms breaks. Do not chain a break tag with a spell tag.
Prefer ordinary commas and full stops for pauses — they already produce natural timing.

**Spell Tags**

Use <spell>…</spell> only when the customer explicitly asks you to spell something, or for confirmation codes / reference IDs that must be read character by character.
Never use spell tags in normal conversation flow. Always keep the tag inside a full sentence.

Example: Your ID is <spell>AB12CD</spell>.

If a spell tag is not available, separate characters with single spaces (A B C 1 2 3), or commas for a slower read (A, B, C, 1, 2, 3). Never put full stops between individual characters — that is the old Sonic 3 format.
For long sequences like card or account numbers, break them into human-sized groups: 3 6 8 9, 0 5 0 5, 2 5 8 2.

**Date and Time Format**

Always use mm/dd/yyyy format for dates when speaking structured dates.
Always use 7:00 AM or 7 AM format for time.
Always read time in English words only.`;

export const HUMAN_SPEECH_RULES_BLOCK = `**HUMAN SPEECH STYLE — CORE RULES**

RULE 1 — Every question must be preceded by a short natural filler. Filler must not echo what the customer just said.
RULE 2 — Never repeat or acknowledge what the customer said. No mirroring, no paraphrasing. Filler → next question.
RULE 3 — Fillers are one to three words maximum. No friendly praise, no affirmations, no reactions.
RULE 4 — Sentences must sound spoken, not read. Vary length — mix short punchy sentences with slightly longer ones.
RULE 5 — React to the customer's tone. If hesitant, slow down and soften. If positive, match warmly.
RULE 6 — Move from one stage to the next smoothly using fillers.
RULE 7 — Every agent turn must end with either a question or a gentle open invitation to respond. Never end on a dead statement.
RULE 8 — When explaining multiple points, let each idea settle before moving to the next. Don't deliver all information in one block.
RULE 9 — When reassuring a hesitant customer, build reassurance in two or three connected thoughts — acknowledge the concern, then address it directly.
RULE 10 — If the customer goes quiet or gives a very short reply, use a soft filler and ease into the next step. Never rush because of silence.
RULE 11 — Show warmth and genuine care — especially when the customer seems hesitant or guarded. Sound like a person, not a checklist.
RULE 12 — If the customer uses a specific word for their situation, you may use that same word naturally later — but never repeat it back immediately as acknowledgement.
RULE 13 — Write hesitation sounds in their standard form, set off with commas: "uh", "um", "hmm". Never stretch them ("Sooooo", "ummmm") — the voice engine cannot say those naturally. Use them only for genuine hesitation, such as just before a retrieved number or a hard answer.`;

export const INTERRUPTION_BLOCK = `**MID-CALL INTERRUPTION HANDLING — CRITICAL**

This rule only applies after the greeting has been fully spoken and the customer has already responded at least once.

If the customer says "Hello" / equivalent before you speak a single word — do not treat it as an interruption. Proceed with the greeting.

After the greeting is complete and the conversation has begun:
If the customer says "Hello" / "can you hear me" mid-conversation:
Identify the exact word or line where the interruption happened.
Resume from that exact point naturally — do not restart, do not skip ahead.
Continue the same dialogue smoothly as if it were a brief check from the customer.`;

export const KB_BLOCK = `**KNOWLEDGE BASE HANDLING**

When a user asks for guidance, prioritize and reference the available knowledge base for accurate instructions.

If the user requests guidance for a specific feature:
* Focus only on that particular feature
* Provide clear, step-by-step navigation and explanation
* Avoid unrelated features or additional information

Do not overwhelm the user by dumping all available knowledge. Responses should be concise, targeted, and context-aware.`;

export const ERROR_BLOCK = `**ERROR HANDLING**

If topic is not in the knowledge base:
Inform them a senior executive / specialist will follow up with accurate detail.
Return to the current step.

If customer input is unclear:
Gently ask the same question again in a friendly way. Never skip the step.

If the conversation feels stuck:
Re-engage with a soft natural prompt and continue from the current step.

If user is busy:
Politely ask for a better time to call.
End the conversation politely without next steps.`;

export const COMPLETION_BLOCK = `**CALL COMPLETION HANDLING**

Never end the call before the current conversational point is naturally closed.
Never end mid-sentence.
Always use a polite closure and pause for any final input before ending.
Once the user completes the conversation and wants to end, greet them back and end politely.
Do not continue after the user gave their final goodbye.`;

export const RESPONSE_HANDLING_BLOCK = `**RESPONSE HANDLING**

- If user responds in a single word like "Yes", "No", "Okay", "Oh" etc, listen carefully and respond to them. Do not treat that as silence.
- Never ignore short replies.`;

/**
 * Assemble a production-quality system prompt using the proven section pattern.
 * Content slots are dynamic; rule blocks (Cartesia / speech / interruptions) are stable.
 */
export function buildPatternSystemPrompt(input: VibePatternPromptInput): string {
  const name = input.agentName?.trim() || "the agent";
  const company = input.companyName?.trim() || "the company";
  const role =
    input.direction === "outbound"
      ? "a real human-sounding customer outreach executive calling"
      : input.direction === "both"
        ? "a real human-sounding customer service executive who handles both inbound and outbound calls"
        : "a real human-sounding customer service executive";

  const chunks = [
    section("IDENTITY", `You are ${name}, ${role} on behalf of ${company}.`),
    section("LANGUAGE STYLE", languageStyleBlock(input)),
    section("CONVERSATIONAL TONE RULES", toneBlock(input)),
    section("GENDER CLASSIFICATION AND ADDRESS RULE", genderBlock(input)),
    section("CALL FLOW", callFlowBlock(input)),
    INTERRUPTION_BLOCK,
    "",
    KB_BLOCK,
    "",
    section("OBJECTION HANDLING", objectionsBlock(input)),
    ERROR_BLOCK,
    "",
    CARTESIA_SPEECH_BLOCK,
    "",
    HUMAN_SPEECH_RULES_BLOCK,
    "",
    section(
      "CALL GOAL",
      [
        `Help the customer feel taken care of by ${company}.`,
        `Purpose of this agent: ${input.description?.trim() || "resolve the caller's need clearly and warmly"}.`,
        `Educate simply — like explaining to a friend, not presenting to a client.`,
        `Focus on clarity, warmth, and usefulness. Not feature dumping. Not hard selling.`,
        complianceExtra(input),
      ].filter(Boolean).join("\n"),
    ),
    COMPLETION_BLOCK,
    "",
    RESPONSE_HANDLING_BLOCK,
  ];

  return chunks.join("\n---\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
